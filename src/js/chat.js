const webSocket = new WebSocket(window.location.href);
let publicKey, privateKey, secretKeys = new Map();

// Elements
const form = document.querySelector('.main__input');
const messageInput = document.querySelector('.main__input__message');
const sendBtn = document.querySelector('.main__input__send');
const messages = document.querySelector('.main__messages');

// Functions
const stringToHexColor = function(str) {
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

const bufferToBase64 = function(buffer) {
    const binary = new Uint8Array(buffer)
        .reduce((a, b) => a + String.fromCharCode(b), '');
    return btoa(binary);
}

const base64ToBuffer = function(base64) {
    return Uint8Array.from(atob(base64), (v) => v.codePointAt(0));
}

const generateKeyPair = async function() {
    return crypto.subtle.generateKey({
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, [ 'deriveKey', 'deriveBits' ]);
}

const exportPublicKey = async function(key) {
    return bufferToBase64(await crypto.subtle.exportKey('spki', key));
}

const importPublicKey = async function(keyData) {
    return crypto.subtle.importKey('spki', base64ToBuffer(keyData), {
        name: 'ECDH',
        namedCurve: 'P-256',
    }, true, []);
}

const deriveSharedSecret = async function(privateKey, publicKey) {
    return crypto.subtle.deriveKey({
        name: 'ECDH',
        public: publicKey
    }, privateKey, {
        name: 'AES-GCM',
        length: 256,
    }, false, [ 'encrypt', 'decrypt' ]);
}

const encryptMessage = async function(key, message) {
    const encodedMessage = new TextEncoder().encode(message);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
    }, key, encodedMessage);
    return {
        content: bufferToBase64(encrypted),
        iv: bufferToBase64(iv)
    }
}

const decryptMessage = async function(key, encryptedMessage, iv) {
    const decrypted = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: base64ToBuffer(iv)
    }, key, base64ToBuffer(encryptedMessage));
    return new TextDecoder().decode(decrypted);
}

const createMessage = async function(sender, uuid, content, iv) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('message__sender');
    senderSpan.style.color = stringToHexColor(sender);
    senderSpan.textContent = sender;

    const contentParagraph = document.createElement('p');
    contentParagraph.classList.add('message__content');
    contentParagraph.textContent = await decryptMessage(secretKeys.get(uuid), content, iv);

    messageDiv.append(senderSpan, contentParagraph);
    messages.prepend(messageDiv);
}

const createAnnouncement = function(content) {
    const announcement = document.createElement('p');
    announcement.classList.add('announcement');
    announcement.textContent = content;
    messages.prepend(announcement);
}

const handleKeyExchange = async function(uuid, encodedKey) {
    const parsedKey = await importPublicKey(encodedKey);
    const secretKey = await deriveSharedSecret(privateKey, parsedKey);
    secretKeys.set(uuid, secretKey);
}

const handleKeyInit = async function(keys) {
    for (const [ uuid, encodedKey ] of Object.entries(keys)) {
        handleKeyExchange(uuid, encodedKey);
    }
}

// Generate key pair
generateKeyPair().then((keyPair) => {
    ({ publicKey, privateKey } = keyPair);
});

// Events
webSocket.addEventListener('open', async () => {
    webSocket.send(JSON.stringify({
        type: 'exchange',
        key: await exportPublicKey(publicKey)
    }));
});

webSocket.addEventListener('message', (event) => {
    const { type, ...data } = JSON.parse(event.data);

    switch (type) {
        case 'message':
            createMessage(data.sender, data.uuid, data.content, data.iv);
            break;
        case 'server':
            createAnnouncement(data.content);
            break;
        case 'exchange':
            handleKeyExchange(data.uuid, data.key);
            break;
        case 'keyinit':
            handleKeyInit(data.keys);
            break;
    }
});

messageInput.addEventListener('input', () => {
    const length = messageInput.value.trim().length;
    sendBtn.disabled = (length === 0 || length > 250);
});

form.addEventListener('submit', async (event) => {
    let messages = {};
    const message = messageInput.value.trim();

    event.preventDefault();
    messageInput.value = '';
    sendBtn.disabled = true;

    for (const [ uuid, secretKey ] of secretKeys) {
        messages[uuid] = await encryptMessage(secretKey, message);
    }

    webSocket.send(JSON.stringify({
        type: 'message',
        messages
    }));
});