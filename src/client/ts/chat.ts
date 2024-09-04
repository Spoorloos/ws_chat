import type { Message, Messages, MessageData, ExchangeKeys } from "../../types";

// Variables
let secretKeys = new Map<string, CryptoKey>();
let publicKey: CryptoKey, privateKey: CryptoKey;
const webSocket = new WebSocket("/socket" + window.location.search);

// Elements
const form = document.querySelector<HTMLFormElement>(".main__input")!;
const messageInput = document.querySelector<HTMLInputElement>(".main__input__message")!;
const sendBtn = document.querySelector<HTMLInputElement>(".main__input__send")!;
const messages = document.querySelector<HTMLDivElement>(".main__messages")!;

// Functions
function sendToServer(data: MessageData) {
    webSocket.send(JSON.stringify(data));
}

function stringToHexColor(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = "#";
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ("00" + value.toString(16)).slice(-2);
    }

    return color;
}

function bufferToBase64(buffer: ArrayLike<number> | ArrayBufferLike) {
    const binary = new Uint8Array(buffer)
        .reduce((a, b) => a + String.fromCharCode(b), "");
    return btoa(binary);
}

function base64ToBuffer(base64: string) {
    return Uint8Array.from(atob(base64), (v) => v.codePointAt(0) ?? 0);
}

async function generateKeyPair() {
    return crypto.subtle.generateKey({
        name: "ECDH",
        namedCurve: "P-256",
    }, true, [ "deriveKey", "deriveBits" ]);
}

async function exportPublicKey(key: CryptoKey) {
    return bufferToBase64(await crypto.subtle.exportKey("spki", key));
}

async function importPublicKey(keyData: string) {
    return crypto.subtle.importKey("spki", base64ToBuffer(keyData), {
        name: "ECDH",
        namedCurve: "P-256",
    }, true, []);
}

async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey) {
    return crypto.subtle.deriveKey({
        name: "ECDH",
        public: publicKey
    }, privateKey, {
        name: "AES-GCM",
        length: 256,
    }, false, [ "encrypt", "decrypt" ]);
}

async function encryptMessage(key: CryptoKey, message: string) {
    const encodedMessage = new TextEncoder().encode(message);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({
        name: "AES-GCM",
        iv,
    }, key, encodedMessage);
    return {
        content: bufferToBase64(encrypted),
        iv: bufferToBase64(iv)
    } as Message
}

async function decryptMessage(key: CryptoKey, encryptedMessage: string, iv: string) {
    const decrypted = await crypto.subtle.decrypt({
        name: "AES-GCM",
        iv: base64ToBuffer(iv)
    }, key, base64ToBuffer(encryptedMessage));
    return new TextDecoder().decode(decrypted);
}

async function createMessage(sender: string, uuid: string, content: string, iv: string) {
    const secretKey = secretKeys.get(uuid);
    if (!secretKey) {
        console.log("ERROR: Received a message from an unknown sender");
        return;
    }

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message");

    const senderSpan = document.createElement("span");
    senderSpan.classList.add("message__sender");
    senderSpan.style.color = stringToHexColor(sender);
    senderSpan.textContent = sender;

    const contentParagraph = document.createElement("p");
    contentParagraph.classList.add("message__content");
    contentParagraph.textContent = await decryptMessage(secretKey, content, iv);

    messageDiv.append(senderSpan, contentParagraph);
    messages.prepend(messageDiv);
}

function createAnnouncement(content: string, isError: boolean = false) {
    const announcement = document.createElement("p");
    announcement.classList.add("announcement");
    announcement.textContent = content;
    if (isError) {
        announcement.style.color = "#F44";
    }
    messages.prepend(announcement);
}

async function handleKeyExchange(uuid: string, encodedKey: string) {
    const parsedKey = await importPublicKey(encodedKey);
    const secretKey = await deriveSharedSecret(privateKey, parsedKey);
    secretKeys.set(uuid, secretKey);
}

async function handleKeyInit(keys: ExchangeKeys) {
    for (const [ uuid, encodedKey ] of Object.entries(keys)) {
        handleKeyExchange(uuid, encodedKey);
    }
}

// Events
webSocket.addEventListener("open", async function() {
    ({ publicKey, privateKey } = await generateKeyPair());

    sendToServer({
        type: "send_exchange",
        key: await exportPublicKey(publicKey)
    });
});

webSocket.addEventListener("message", function(event) {
    const data: MessageData = JSON.parse(event.data);

    switch (data.type) {
        case "message":
            createMessage(data.sender!, data.uuid!, data.content!, data.iv!);
            break;
        case "announcement":
            createAnnouncement(data.content!);
            break;
        case "exchange":
            handleKeyExchange(data.uuid!, data.key!);
            break;
        case "keyinit":
            handleKeyInit(data.keys!);
            break;
    }
});

webSocket.addEventListener("close", function() {
    createAnnouncement("Your connection to the server was terminated.", true);
});

webSocket.addEventListener("error", function() {
    createAnnouncement("There was an error related to the server. Attempting to reconnect in 2 seconds...", true);
    setTimeout(() => window.location.reload(), 2000);
});

messageInput.addEventListener("input", function() {
    const length = messageInput.value.trim().length;
    sendBtn.disabled = (length === 0 || length > 256);
});

form.addEventListener("submit", async function(event) {
    event.preventDefault();

    const messages: Messages = {};
    const message = messageInput.value.trim();

    messageInput.value = "";
    sendBtn.disabled = true;

    await Promise.all([ ...secretKeys ].map(async ([ uuid, secretKey ]) => {
        messages[uuid] = await encryptMessage(secretKey, message);
    }));

    sendToServer({
        type: "send_message",
        messages
    });
});