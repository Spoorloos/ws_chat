import chalk from 'chalk';
import type { ServerWebSocket } from 'bun';

// Types
interface WsData {
    readonly uuid: string;
    readonly username: string;
    readonly room: string;
}

interface CustomWebSocket extends ServerWebSocket<unknown> {
    readonly data: WsData;
}

interface Room {
    readonly publicKeys: Map<string, string>
}

interface Message {
    readonly content: string,
    readonly iv: string
}

interface Messages {
    readonly [targetUuid: string]: Message
}

interface MessageResponse {
    readonly type: string,
    readonly messages?: Messages,
    readonly key?: string
}

// Variables
let sockets: Map<string, CustomWebSocket> = new Map();
let rooms: Map<string, Room> = new Map();

// Functions
const log = function(message: string) {
    console.log(chalk.gray(new Date().toLocaleTimeString()), message);
}

const handleOpen = function(ws: CustomWebSocket) {
    let { username, room, uuid } = ws.data;

    ws.subscribe(room);
    sockets.set(uuid, ws);

    if (!rooms.has(room)) {
        rooms.set(room, { publicKeys: new Map() });
    }

    server.publish(room, JSON.stringify({
        type: 'server',
        content: `${username} has joined the room!`
    }));

    ws.send(JSON.stringify({
        type: 'keyinit',
        keys: Object.fromEntries(rooms.get(room)!.publicKeys)
    }));

    log(`${username} joined room "${room}"`);
}

const handleClose = function(ws: CustomWebSocket) {
    const { username, room, uuid } = ws.data;

    ws.unsubscribe(room);
    sockets.delete(uuid);

    if (rooms.has(room)) {
        const { publicKeys } = rooms.get(room)!;
        publicKeys.delete(uuid);
        if (publicKeys.size === 0) {
            rooms.delete(room);
        }
    }

    server.publish(room, JSON.stringify({
        type: 'server',
        content: `${username} has left the room!`
    }));

    log(`${username} left room "${room}"`);
}

const handleMessage = function({ username, room, uuid }: WsData, messages: Messages) {
    if (!messages) return;

    for (const [ targetUuid, message ] of Object.entries(messages)) {
        if (!targetUuid || !message || !message.content || !message.iv) {
            continue;
        }

        const socket = sockets.get(targetUuid);
        if (socket) socket.send(JSON.stringify({
            type: 'message',
            sender: username,
            uuid,
            ...message
        }));
    }

    log(`${username} sent a message in room "${room}"`);
}

const handleExchange = function({ room, uuid }: WsData, key: string) {
    if (!key) return;

    if (rooms.has(room)) {
        rooms.get(room)!.publicKeys.set(uuid, key);
    }

    server.publish(room, JSON.stringify({
        type: 'exchange',
        uuid,
        key
    }));
}

// Setup server
const server = Bun.serve({
    port: 3000,
    cert: Bun.file('./certs/cert.pem'),
    key: Bun.file('./certs/key.pem'),
    passphrase: '12345',
    websocket: {
        open: handleOpen,
        close: handleClose,
        message: (ws: CustomWebSocket, received: string) => {
            const { type, ...data }: MessageResponse = JSON.parse(received);

            switch (type) {
                case 'message':
                    handleMessage(ws.data, data.messages!);
                    break;
                case 'exchange':
                    handleExchange(ws.data, data.key!);
                    break;
            }
        }
    },
    fetch: async (request, server) => {
        const { pathname, searchParams } = new URL(request.url);

        // Serve the start page
        if (pathname === '/') {
            return new Response(Bun.file('./src/login.html'), { status: 200 });
        }

        // Serve the chat page
        else if (pathname === '/chat') {
            // Validate the data
            const data: WsData = {
                username: searchParams.get('username') || 'Anonymous',
                room: searchParams.get('room') || '1',
                uuid: crypto.randomUUID()
            }

            if (data.username.length > 20 || data.room.length > 50) {
                return new Response(null, { status: 400 });
            }

            // Websocket upgrade logic
            if (request.headers.get('upgrade') === 'websocket') {
                if (server.upgrade(request, { data })) {
                    return;
                }
                return new Response('Upgrade failed', { status: 500 });
            }

            // Serve the chat page if it's not a websocket upgrade
            return new Response(Bun.file("./src/chat.html"), { status: 200 });
        }

        // Serve any other files requested
        else {
            const file = Bun.file('./src' + pathname);
            return (await file.exists()) ?
                new Response(file) :
                new Response(null, { status: 404 });
        }
    }
});

console.log(`Server started at ${chalk.blueBright(server.url)}`);