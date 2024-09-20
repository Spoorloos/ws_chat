import type { ErrorLike } from "bun";
import type { WSData, WSServer, User, Message, MessageData, SafeCallResult, OneOrMore, AnyFunction } from "./types";

// Variables
const sockets = new Map<string, WSServer>();
const rooms = new Map<string, Map<string, User>>();

enum Colors {
    Gray = 90,
    Red = 91,
    Blue = 94
}

// Functions
function colorText<T extends Colors>(color: T, ...value: OneOrMore) {
    return `\u001b[${color}m${value.join(" ")}\u001b[0m` as const;
}

function log(...message: OneOrMore) {
    console.log(colorText(Colors.Gray, new Date().toLocaleTimeString()), ...message);
}

function logError(...error: OneOrMore) {
    log(colorText(Colors.Red, "The server encountered an error:"));
    console.error(...error);
}

function sendToRoom(room: string, data: MessageData) {
    server.publish(room, JSON.stringify(data));
}

function sendToClient(client: WSServer, data: MessageData) {
    client.send(JSON.stringify(data));
}

async function loadFileIfExists(path: string) {
    const file = Bun.file(path);
    return (await file.exists()) ? file : undefined;
}

function safeCall<T extends AnyFunction>(
    this: unknown,
    callback: T,
    ...args: Parameters<T>
): SafeCallResult<ReturnType<T>> {
    try {
        return [ true, callback.apply(this, args) ];
    } catch (error) {
        return [ false, error ];
    }
}

function wrapInErrorHandler<T extends AnyFunction>(callback: T) {
    return function(
        this: unknown,
        ...args: Parameters<T>
    ): ReturnType<T> | undefined {
        try {
            return callback.apply(this, args);
        } catch (error) {
            logError(error);
        }
    }
}

// Websocket
function handleOpen(ws: WSServer) {
    const { userID, userName, roomName } = ws.data;

    ws.subscribe(roomName);
    sockets.set(userID, ws);

    let room = rooms.get(roomName);
    if (!room) {
        rooms.set(roomName, room = new Map());
    }

    sendToClient(ws, {
        type: "keyinit",
        keys: Object.fromEntries(
            [ ...room.entries() ].map((v) => [ v[0], v[1].key ])
        ),
    });

    sendToRoom(roomName, {
        type: "announcement",
        content: `${userName} has joined the room!`,
    });

    log(`${userName} joined room "${roomName}"`);
}

function handleClose(ws: WSServer) {
    const { userID, userName, roomName } = ws.data;

    ws.unsubscribe(roomName);
    sockets.delete(userID);

    const users = rooms.get(roomName);
    if (users) {
        users.delete(userID);

        if (users.size === 0) {
            rooms.delete(roomName);
        }
    }

    sendToRoom(roomName, {
        type: "announcement",
        content: `${userName} has left the room!`,
    });

    log(`${userName} left room "${roomName}"`);
}

function getMessageLength(encrypted: string) {
    return atob(encrypted).length - 16;
}

function isMessage(message: unknown): message is Message {
    return message !== null
        && typeof message === "object"
        && typeof (message as Message).content === "string"
        && typeof (message as Message).iv === "string";
}

function handleUserMessage(data: WSData, messages: Object) {
    for (const [ targetID, message ] of Object.entries(messages)) {
        if (!isMessage(message)) continue;

        const ws = sockets.get(targetID);
        if (!ws) continue;

        const length = getMessageLength(message.content);
        if (length <= 0 || length > 256) continue;

        sendToClient(ws, {
            type: "message",
            sender: data.userName,
            uuid: data.userID,
            content: message.content,
            iv: message.iv,
        });
    }

    log(`${data.userName} sent a message in room "${data.roomName}"`);
}

function handleExchange(data: WSData, key: string) {
    const users = rooms.get(data.roomName);
    if (!users || users.has(data.userID)) return;

    users.set(data.userID, {
        name: data.userName,
        key,
    });

    sendToRoom(data.roomName, {
        type: "exchange",
        uuid: data.userID,
        key,
    });
}

function isMessageData(data: unknown): data is MessageData {
    return data !== null
        && typeof data === "object"
        && typeof (data as MessageData).type === "string";
}

function handleMessage(ws: WSServer, received: string) {
    const [ success, data ] = safeCall(JSON.parse, received);
    if (!success || !isMessageData(data)) {
        ws.terminate();
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
            ws.terminate();
    }
}

// Routing
function isUsernameTaken(roomName: string, userName: string) {
    const room = rooms.get(roomName);
    if (!room) return false;

    for (const user of room.values()) {
        if (user.name === userName) return true;
    }

    return false;
}

function upgradeSocket(request: Request, searchParams: URLSearchParams) {
    const userName = searchParams.get("username") || "Anonymous";
    const roomName = searchParams.get("room");

    if (userName.length > 16 || !roomName || roomName.length > 32) {
        return new Response("Invalid data sent", { status: 400 });
    }

    if (userName !== "Anonymous" && isUsernameTaken(roomName, userName)) {
        return new Response("Username taken", { status: 409 });
    }

    const data: WSData = {
        userID: crypto.randomUUID(),
        userName,
        roomName,
    }

    if (!server.upgrade(request, { data })) {
        return new Response("Upgrade failed", { status: 500 });
    }
}

async function handleFetch(request: Request) {
    const { pathname: pathName, searchParams } = new URL(request.url);

    switch (pathName) {
        case "/":
            return new Response(Bun.file("./src/client/login.html"));
        case "/chat":
            return new Response(Bun.file("./src/client/chat.html"));
        case "/socket":
            return upgradeSocket(request, searchParams);
        default:
            const file = await loadFileIfExists("./build" + pathName);
            return new Response(file, file ? undefined : { status: 404 });
    }
}

function handleError(error: ErrorLike) {
    logError(error);
    return new Response(`The server encountered an error:\n"${error}"`, {
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
        perMessageDeflate: true,
        maxPayloadLength: 1024,
    },
    tls: {
        cert: await loadFileIfExists("./certs/" + Bun.env.CERT ?? "cert.pem"),
        key: await loadFileIfExists("./certs/" + Bun.env.KEY ?? "key.pem"),
        passphrase: Bun.env.PASSPHRASE,
    },
});

console.log("Server started at " + colorText(Colors.Blue, server.url.toString()));