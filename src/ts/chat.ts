// Types
interface Message {
    readonly content: string,
    readonly iv: string
}

interface Messages {
    [targetUuid: string]: Message
}

interface KeyExchangeData {
    readonly [uuid: string]: string
}

interface MessageResponse {
    readonly type: string,
    readonly sender?: string,
    readonly uuid?: string,
    readonly content?: string,
    readonly iv?: string,
    readonly key?: string,
    readonly keys?: KeyExchangeData
}

// Variables
const webSocket = new WebSocket(window.location.href);
let publicKey: CryptoKey, privateKey: CryptoKey;
let secretKeys: Map<string, CryptoKey> = new Map();

// Elements
const form: HTMLFormElement = document.querySelector('.main__input')!;
const messageInput: HTMLInputElement = document.querySelector('.main__input__message')!;
const sendBtn: HTMLInputElement = document.querySelector('.main__input__send')!;
const messages: HTMLDivElement = document.querySelector('.main__messages')!;

// Functions
function stringToHexColor(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).slice(-2);
    }

    return color;
}

function bufferToBase64(buffer: ArrayLike<number> | ArrayBufferLike) {
    const binary = new Uint8Array(buffer)
        .reduce((a, b) => a + String.fromCharCode(b), '');
    return btoa(binary);
}

function base64ToBuffer(base64: string) {
    return Uint8Array.from(atob(base64), (v) => v.codePointAt(0) ?? 0);
}

async function generateKeyPair() {
    return crypto.subtle.generateKey({
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, [ 'deriveKey', 'deriveBits' ]);
}

async function exportPublicKey(key: CryptoKey) {
    return bufferToBase64(await crypto.subtle.exportKey('spki', key));
}

async function importPublicKey(keyData: string) {
    return crypto.subtle.importKey('spki', base64ToBuffer(keyData), {
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, []);
}

async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey) {
    return crypto.subtle.deriveKey({
        name: 'ECDH',
        public: publicKey
    }, privateKey, {
        name: 'AES-GCM',
        length: 256,
    }, false, [ 'encrypt', 'decrypt' ]);
}

async function encryptMessage(key: CryptoKey, message: string) {
    const encodedMessage = new TextEncoder().encode(message);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
    }, key, encodedMessage);
    return {
        content: bufferToBase64(encrypted),
        iv: bufferToBase64(iv)
    } as Message
}

async function decryptMessage(key: CryptoKey, encryptedMessage: string, iv: string) {
    const decrypted = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: base64ToBuffer(iv)
    }, key, base64ToBuffer(encryptedMessage));
    return new TextDecoder().decode(decrypted);
}

async function createMessage(sender: string, uuid: string, content: string, iv: string) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('message__sender');
    senderSpan.style.color = stringToHexColor(sender);
    senderSpan.textContent = sender;

    const contentParagraph = document.createElement('p');
    contentParagraph.classList.add('message__content');
    if (secretKeys.has(uuid)) {
        contentParagraph.textContent = await decryptMessage(secretKeys.get(uuid)!, content, iv);
    }

    messageDiv.append(senderSpan, contentParagraph);
    messages.prepend(messageDiv);
}

function createAnnouncement(content: string) {
    const announcement = document.createElement('p');
    announcement.classList.add('announcement');
    announcement.textContent = content;
    messages.prepend(announcement);
}

async function handleKeyExchange(uuid: string, encodedKey: string) {
    const parsedKey = await importPublicKey(encodedKey);
    const secretKey = await deriveSharedSecret(privateKey, parsedKey);
    secretKeys.set(uuid, secretKey);
}

async function handleKeyInit(keys: KeyExchangeData) {
    for (const [ uuid, encodedKey ] of Object.entries(keys)) {
        handleKeyExchange(uuid, encodedKey);
    }
}

// Events
webSocket.addEventListener('open', async () => {
    const keyPair = await generateKeyPair();

    ({ publicKey, privateKey } = keyPair);

    webSocket.send(JSON.stringify({
        type: 'exchange',
        key: await exportPublicKey(publicKey)
    }));
});

webSocket.addEventListener('message', (event) => {
    const { type, ...data }: MessageResponse = JSON.parse(event.data);

    switch (type) {
        case 'message':
            createMessage(data.sender!, data.uuid!, data.content!, data.iv!);
            break;
        case 'server':
            createAnnouncement(data.content!);
            break;
        case 'exchange':
            handleKeyExchange(data.uuid!, data.key!);
            break;
        case 'keyinit':
            handleKeyInit(data.keys!);
            break;
    }
});

messageInput.addEventListener('input', () => {
    const length = messageInput.value.trim().length;
    sendBtn.disabled = (length === 0 || length > 250);
});

form.addEventListener('submit', async (event) => {
    const messages: Messages = {};
    const message = messageInput.value.trim();

    event.preventDefault();
    messageInput.value = '';
    sendBtn.disabled = true;

    await Promise.all([ ...secretKeys ].map(async ([ uuid, secretKey ]) => {
        messages[uuid] = await encryptMessage(secretKey, message);
    }));

    webSocket.send(JSON.stringify({
        type: 'message',
        messages
    }));
});
