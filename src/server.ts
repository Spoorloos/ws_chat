import type { ErrorLike } from "bun";
import type { WsData, CustomWebSocket, Message, Messages, MessageData, SafeCallResult } from "./types";

// Variables
const sockets = new Map<string, CustomWebSocket>();
const roomClientKeys = new Map<string, Map<string, string>>();
const textColors = {
    gray: [ "\u001b[90m", "\u001b[39m" ],
    red: [ "\u001b[91m", "\u001b[39m" ],
    blue: [ "\u001b[94m", "\u001b[39m" ]
}

// Functions
function colorText(color: keyof typeof textColors, text: any) {
    const [ prefix, suffix ] = textColors[color];
    return prefix + text + suffix;
}

function log(...message: any[]) {
    console.log(colorText("gray", new Date().toLocaleTimeString()), ...message);
}

function logError(error: any) {
    log(colorText("red", "The server encountered an error:"));
    console.error(error);
}

function sendToRoom(room: string, data: MessageData) {
    server.publish(room, JSON.stringify(data));
}

function sendToClient(client: CustomWebSocket, data: MessageData) {
    client.send(JSON.stringify(data));
}

async function loadFileIfExists(path: string) {
    const file = Bun.file(path);
    return (await file.exists()) ? file : undefined;
}

function safeCall<T extends (...args: any[]) => any>(
    callback: T,
    ...args: Parameters<T>
): SafeCallResult<ReturnType<T>> {
    try {
        return [ true, callback.apply(this, args) ];
    } catch (error) {
        return [ false, error ];
    }
}

function wrapInErrorHandler<T extends (...args: any[]) => any>(callback: T): T {
    return function(...args: Parameters<T>): ReturnType<T> | undefined {
        try {
            return callback.apply(this, args);
        } catch (error) {
            logError(error);
        }
    } as T;
}

const test = {
    [""]: null
}


// Websocket
function handleOpen(ws: CustomWebSocket) {
    const { username, room, uuid } = ws.data;

    ws.subscribe(room);
    sockets.set(uuid, ws);

    if (!roomClientKeys.has(room)) {
        roomClientKeys.set(room, new Map());
    }

    sendToRoom(room, {
        type: "announcement",
        content: `${username} has joined the room!`,
    });

    sendToClient(ws, {
        type: "keyinit",
        keys: Object.fromEntries(roomClientKeys.get(room)!),
    });

    log(`${username} joined room "${room}"`);
}

function handleClose(ws: CustomWebSocket) {
    const { username, room, uuid } = ws.data;

    ws.unsubscribe(room);
    sockets.delete(uuid);

    const keys = roomClientKeys.get(room);
    if (keys) {
        keys.delete(uuid);

        if (keys.size === 0) {
            roomClientKeys.delete(room);
        }
    }

    sendToRoom(room, {
        type: "announcement",
        content: `${username} has left the room!`,
    });

    log(`${username} left room "${room}"`);
}

function getMessageLength(encrypted: string) {
    return atob(encrypted).length - 16;
}

function isMessage(message: unknown): message is Message {
    return message !== null &&
        typeof message === "object" &&
        typeof (message as any).content === "string" &&
        typeof (message as any).iv === "string";
}

function handleUserMessage(data: WsData, messages: Messages) {
    for (const [ targetUuid, message ] of Object.entries(messages)) {
        if (typeof targetUuid !== "string" || !isMessage(message)) continue;

        const ws = sockets.get(targetUuid);
        if (!ws) continue;

        const length = getMessageLength(message.content);
        if (length === 0 || length > 256) continue;

        sendToClient(ws, {
            type: "message",
            sender: data.username,
            uuid: data.uuid,
            content: message.content,
            iv: message.iv,
        });
    }

    log(`${data.username} sent a message in room "${data.room}"`);
}

function handleExchange(data: WsData, key: string) {
    const keys = roomClientKeys.get(data.room);
    if (!keys || keys.has(data.uuid)) return;

    keys.set(data.uuid, key);

    sendToRoom(data.room, {
        type: "exchange",
        uuid: data.uuid,
        key,
    });
}

function isMessageData(data: unknown): data is MessageData {
    return typeof data === "object" && data !== null && "type" in data;
}

function handleMessage(ws: CustomWebSocket, received: string) {
    const [ success, data ] = safeCall(JSON.parse, received);
    if (!success || !isMessageData(data)) {
        ws.close(1011);
        return;
    }

    switch (data.type) {
        case "send_message":
            if (typeof data.messages === "object" && data.messages !== null) {
                handleUserMessage(ws.data, data.messages);
            }
            break;
        case "send_exchange":
            if (typeof data.key === "string") {
                handleExchange(ws.data, data.key);
            }
            break;
        default:
            ws.close(1011);
    }
}

// Routing
function upgradeSocket(request: Request, searchParams: URLSearchParams) {
    const username = searchParams.get("username") || "Anonymous";
    const room = searchParams.get("room");

    if (username.length > 16 || !room || room.length > 32) {
        return new Response("Invalid data sent", { status: 400 });
    }

    const data: WsData = {
        uuid: crypto.randomUUID(),
        username,
        room,
    };

    if (!server.upgrade(request, { data })) {
        return new Response("Upgrade failed", { status: 500 });
    }
}

async function handleFetch(request: Request) {
    const { pathname: pathName, searchParams } = new URL(request.url);

    switch (pathName) {
        case "/":
            return new Response(Bun.file("./src/client/index.html"));
        case "/chat":
            return new Response(Bun.file("./src/client/chat.html"));
        case "/socket":
            return upgradeSocket(request, searchParams);
        default:
            const file = await loadFileIfExists("./src/client" + pathName);
            return new Response(file, file ? undefined : { status: 404 });
    }
}

function handleError(error: ErrorLike) {
    logError(error);
    return new Response(`The server encountered an error! "${error}"`, {
        status: 500,
    });
}

// Setup server
const server = Bun.serve({
    development: false,
    fetch: handleFetch,
    error: handleError,
    websocket: {
        open: wrapInErrorHandler(handleOpen),
        close: wrapInErrorHandler(handleClose),
        message: wrapInErrorHandler(handleMessage),
    },
    tls: {
        cert: await loadFileIfExists("./certs/" + Bun.env.CERT ?? "cert.pem"),
        key: await loadFileIfExists("./certs/" + Bun.env.KEY ?? "key.pem"),
        passphrase: Bun.env.PASSPHRASE,
    },
});

console.log("Server started at " + colorText("blue", server.url));