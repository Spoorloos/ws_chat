import chalk from 'chalk';
import type { ServerWebSocket } from 'bun';

// Types
interface WsData {
    uuid: string;
    username: string;
    room: string;
}

interface CustomWebSocket extends ServerWebSocket<unknown> {
    data: WsData;
}

interface Room {
    publicKeys: Map<string, string>
}

interface Message {
    content: string,
    iv: string
}

interface Messages {
    [targetUuid: string]: Message
}

interface MessageResponse {
    type: string,
    messages?: Messages,
    key?: string
}

// Variables
let sockets: Map<string, CustomWebSocket> = new Map();
let rooms: Map<string, Room> = new Map();

// Functions
const handleOpen = function(ws: CustomWebSocket) {
    let { username, room, uuid } = ws.data;

    ws.subscribe(room);
    sockets.set(uuid, ws);

    server.publish(room, JSON.stringify({
        type: 'server',
        content: `${username} has joined the room!`
    }));

    if (!rooms.has(room)) {
        rooms.set(room, { publicKeys: new Map() });
    }

    ws.send(JSON.stringify({
        type: 'keyinit',
        keys: Object.fromEntries(rooms.get(room)!.publicKeys)
    }));

    console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} joined room "${room}"`);
}

const handleClose = function(ws: CustomWebSocket) {
    const { username, room, uuid } = ws.data;

    ws.unsubscribe(room);

    if (rooms.has(room)) {
        rooms.get(room)!.publicKeys.delete(uuid);
    }

    server.publish(room, JSON.stringify({
        type: 'server',
        content: `${username} has left the room!`
    }));

    console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} left room "${room}"`);
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

    console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} sent a message in room "${room}"`);
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