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
    type: string,
    sender?: string,
    uuid?: string,
    content?: string,
    iv?: string,
    key?: string,
    keys?: KeyExchangeData
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
const stringToHexColor = function(str: string) {
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

const bufferToBase64 = function(buffer: ArrayLike<number> | ArrayBufferLike): string {
    const binary = new Uint8Array(buffer)
        .reduce((a, b) => a + String.fromCharCode(b), '');
    return btoa(binary);
}

const base64ToBuffer = function(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (v) => v.codePointAt(0) ?? 0);
}

const generateKeyPair = async function(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, [ 'deriveKey', 'deriveBits' ]);
}

const exportPublicKey = async function(key: CryptoKey): Promise<string> {
    return bufferToBase64(await crypto.subtle.exportKey('spki', key));
}

const importPublicKey = async function(keyData: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('spki', base64ToBuffer(keyData), {
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, []);
}

const deriveSharedSecret = async function(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
    return crypto.subtle.deriveKey({
        name: 'ECDH',
        public: publicKey
    }, privateKey, {
        name: 'AES-GCM',
        length: 256,
    }, false, [ 'encrypt', 'decrypt' ]);
}

const encryptMessage = async function(key: CryptoKey, message: string): Promise<Message> {
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

const decryptMessage = async function(key: CryptoKey, encryptedMessage: string, iv: string): Promise<string> {
    const decrypted = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: base64ToBuffer(iv)
    }, key, base64ToBuffer(encryptedMessage));
    return new TextDecoder().decode(decrypted);
}

const createMessage = async function(sender: string, uuid: string, content: string, iv: string) {
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

const createAnnouncement = function(content: string) {
    const announcement = document.createElement('p');
    announcement.classList.add('announcement');
    announcement.textContent = content;
    messages.prepend(announcement);
}

const handleKeyExchange = async function(uuid: string, encodedKey: string) {
    const parsedKey = await importPublicKey(encodedKey);
    const secretKey = await deriveSharedSecret(privateKey, parsedKey);
    secretKeys.set(uuid, secretKey);
}

const handleKeyInit = async function(keys: KeyExchangeData) {
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

    await Promise.all([...secretKeys].map(async ([ uuid, secretKey ]) => {
        messages[uuid] = await encryptMessage(secretKey, message);
    }));

    webSocket.send(JSON.stringify({
        type: 'message',
        messages
    }));
});