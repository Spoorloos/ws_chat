import chalk from 'chalk';
import type { ErrorLike } from 'bun';
import type { WsData, CustomWebSocket, Messages, MessageData } from './types';

// Variables
const sockets = new Map<string, CustomWebSocket>();
const roomClientKeys = new Map<string, Map<string, string>>();

// Functions
function log(...message: any[]) {
    console.log(chalk.gray(new Date().toLocaleTimeString()), ...message);
}

function sendToRoom(room: string, data: MessageData) {
    server.publish(room, JSON.stringify(data));
}

function sendToClient(client: CustomWebSocket, data: MessageData) {
    client.send(JSON.stringify(data));
}

function getMessageLength(encrypted: string) {
    return atob(encrypted).length - 16;
}

async function getFile(path: string) {
    const file = Bun.file(path);
    return (await file.exists()) ? file : undefined;
}

// Websocket
function handleOpen(ws: CustomWebSocket) {
    let { username, room, uuid } = ws.data;

    ws.subscribe(room);
    sockets.set(uuid, ws);

    if (!roomClientKeys.has(room)) {
        roomClientKeys.set(room, new Map());
    }

    sendToRoom(room, {
        type: 'announcement',
        content: `${username} has joined the room!`
    });

    sendToClient(ws, {
        type: 'keyinit',
        keys: Object.fromEntries(roomClientKeys.get(room)!)
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
        type: 'announcement',
        content: `${username} has left the room!`
    });

    log(`${username} left room "${room}"`);
}

function handleUserMessage({ username, room, uuid }: WsData, messages: Messages) {
    for (const [ targetUuid, message ] of Object.entries(messages)) {
        if (!targetUuid || !message) continue;

        const ws = sockets.get(targetUuid);
        if (!ws) continue;

        const { content, iv } = message;
        if (!content || !iv) continue;

        const contentLength = getMessageLength(content);
        if (contentLength === 0 || contentLength > 250) continue;

        sendToClient(ws, {
            type: 'message',
            sender: username,
            uuid,
            content,
            iv
        });
    }

    log(`${username} sent a message in room "${room}"`);
}

function handleExchange({ room, uuid }: WsData, key: string) {
    const keys = roomClientKeys.get(room);
    if (keys) {
        keys.set(uuid, key);
    }

    sendToRoom(room, {
        type: 'exchange',
        uuid,
        key
    });
}

function handleMessage(ws: CustomWebSocket, received: string) {
    const data: MessageData = JSON.parse(received);

    switch (data.type) {
        case 'send_message':
            if (data.messages) {
                handleUserMessage(ws.data, data.messages);
            }
            break;
        case 'send_exchange':
            if (data.key) {
                handleExchange(ws.data, data.key);
            }
            break;
    }
}

// Routing
function upgradeSocket(request: Request, searchParams: URLSearchParams) {
    const username = searchParams.get('username') || 'Anonymous';
    const room = searchParams.get('room');

    if (username.length > 25 || !room || room.length > 50) {
        return new Response(null, { status: 400 });
    }

    const data: WsData = {
        uuid: crypto.randomUUID(),
        username,
        room
    }

    if (!server.upgrade(request, { data })) {
        return new Response('Upgrade failed', { status: 500 });
    }
}

async function handleFetch(request: Request) {
    const { pathname, searchParams } = new URL(request.url);

    switch (pathname) {
        case '/':
            return new Response(Bun.file('./src/client/index.html'));
        case '/chat':
            return new Response(Bun.file('./src/client/chat.html'));
        case '/socket':
            return upgradeSocket(request, searchParams);
        default:
            const file = await getFile('./src/client' + pathname);
            return new Response(file, file ? undefined : { status: 404 });
    }
}

function handleError(error: ErrorLike) {
    log(chalk.redBright('The server encountered an error!'), `"${error}"`);
    return new Response(`The server encountered an error! "${error}"`, { status: 500 });
}

// Setup server
const server = Bun.serve({
    development: false,
    fetch: handleFetch,
    error: handleError,
    websocket: {
        open: handleOpen,
        close: handleClose,
        message: handleMessage
    },
    tls: {
        cert: await getFile('./certs/' + Bun.env.CERT ?? 'cert.pem'),
        key: await getFile('./certs/' + Bun.env.KEY ?? 'key.pem'),
        passphrase: Bun.env.PASSPHRASE,
    }
});

console.log('Server started at ' + chalk.blueBright(server.url));