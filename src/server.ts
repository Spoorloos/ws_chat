import chalk from 'chalk';
import type { ErrorLike, Server } from 'bun';
import type { WsData, CustomWebSocket, Room, Messages, MessageData } from './types';

// Variables
const sockets = new Map<string, CustomWebSocket>();
const rooms = new Map<string, Room>();

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

function handleOpen(ws: CustomWebSocket) {
    let { username, room, uuid } = ws.data;

    ws.subscribe(room);
    sockets.set(uuid, ws);

    if (!rooms.has(room)) {
        rooms.set(room, { publicKeys: new Map() });
    }

    sendToRoom(room, {
        type: 'server',
        content: `${username} has joined the room!`
    });

    sendToClient(ws, {
        type: 'keyinit',
        keys: Object.fromEntries(rooms.get(room)!.publicKeys)
    });

    log(`${username} joined room "${room}"`);
}

function handleClose(ws: CustomWebSocket) {
    const { username, room, uuid } = ws.data;

    ws.unsubscribe(room);
    sockets.delete(uuid);

    const roomData = rooms.get(room);
    if (roomData) {
        roomData.publicKeys.delete(uuid);

        if (roomData.publicKeys.size === 0) {
            rooms.delete(room);
        }
    }

    sendToRoom(room, {
        type: 'server',
        content: `${username} has left the room!`
    });

    log(`${username} left room "${room}"`);
}

function handleMessage(ws: CustomWebSocket, received: string) {
    const { type, ...data }: MessageData = JSON.parse(received);

    switch (type) {
        case 'message':
            if (data.messages) {
                handleUserMessage(ws.data, data.messages);
            }
            break;
        case 'exchange':
            if (data.key) {
                handleExchange(ws.data, data.key);
            }
            break;
    }
}

function handleUserMessage({ username, room, uuid }: WsData, messages: Messages) {
    for (const [ targetUuid, message ] of Object.entries(messages)) {
        if (!targetUuid) continue;

        const { content, iv } = message ?? {};
        if (!content || !iv) continue;

        const ws = sockets.get(targetUuid);
        if (!ws) continue;

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
    const roomData = rooms.get(room);
    if (roomData) {
        roomData.publicKeys.set(uuid, key);
    }

    sendToRoom(room, {
        type: 'exchange',
        uuid,
        key
    });
}

async function getFile(path: string) {
    const file = Bun.file(path);
    return (await file.exists()) ? file : undefined;
}

function serveLoginRoute() {
    return new Response(Bun.file('./src/client/login.html'));
}

function serveChatRoute(request: Request, searchParams: URLSearchParams) {
    const username = searchParams.get('username');
    const room = searchParams.get('room');

    if (!username || username.length > 20 || !room || room.length > 50) {
        return new Response(null, { status: 400 });
    }

    if (request.headers.get('upgrade') === 'websocket') {
        const data: WsData = {
            username,
            room,
            uuid: crypto.randomUUID()
        }

        if (server.upgrade(request, { data })) {
            return;
        }

        return new Response('Upgrade failed', { status: 500 });
    }

    return new Response(Bun.file('./src/client/chat.html'));
}

async function handleFetch(request: Request, server: Server) {
    const { pathname, searchParams } = new URL(request.url);

    switch (pathname) {
        case '/':
            return serveLoginRoute();
        case '/chat':
            return serveChatRoute(request, searchParams);
        default:
            const file = await getFile('./src/client' + pathname);
            return file ?
                new Response(file) :
                new Response(null, { status: 404 });
    }
}

function handleError(request: ErrorLike) {
    log(chalk.redBright('The server encountered an error!'), `"${request.message}"`);
    return new Response(`The server encountered an error! "${request.message}"`, { status: 500 });
}

// Setup server
const server = Bun.serve({
    port: 3000,
    development: false,
    fetch: handleFetch,
    error: handleError,
    websocket: {
        open: handleOpen,
        close: handleClose,
        message: handleMessage
    },
    tls: {
        cert: await getFile('./certs/cert.pem'),
        key: await getFile('./certs/key.pem'),
        passphrase: 'niggaman',
    },
});

console.log(`Server started at ${chalk.blueBright(server.url)}`);