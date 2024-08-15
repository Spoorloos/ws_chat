import chalk from 'chalk';

let sockets = new Map();
let rooms = new Map();

const server = Bun.serve({
    port: 3000,
    cert: Bun.file('./certs/cert.pem'),
    key: Bun.file('./certs/key.pem'),
    passphrase: 'niggaman',
    websocket: {
        open: (ws) => {
            let { username, room, uuid } = ws.data;

            ws.subscribe(room);
            ws.data.uuid = uuid = crypto.randomUUID();
            sockets.set(uuid, ws);

            server.publish(room, JSON.stringify({
                type: 'server',
                content: `${username} has joined the room!`
            }));

            console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} joined room "${room}"`);

            if (!rooms.has(room)) {
                rooms.set(room, { publicKeys: new Map() });
            }

            ws.send(JSON.stringify({
                type: 'keyinit',
                keys: Object.fromEntries(rooms.get(room).publicKeys)
            }));
        },
        close: (ws) => {
            const { username, room, uuid } = ws.data;

            ws.unsubscribe(room);
            rooms.get(room).publicKeys.delete(uuid);
            server.publish(room, JSON.stringify({
                type: 'server',
                content: `${username} has left the room!`
            }));

            console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} left room "${room}"`);
        },
        message: (ws, received) => {
            const { username, room, uuid } = ws.data;
            const { type, ...data } = JSON.parse(received);

            switch (type) {
                case 'message':
                    if (!data.messages) return;

                    console.log(chalk.gray(new Date().toLocaleTimeString()), `${username} sent a message in room "${room}"`);

                    for (const [ targetUuid, message ] of Object.entries(data.messages)) {
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
                    break;
                case 'exchange':
                    if (!data.key) return;

                    rooms.get(room).publicKeys.set(uuid, data.key);
                    server.publish(room, JSON.stringify({
                        type,
                        uuid,
                        key: data.key
                    }));

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
            const data = {
                username: searchParams.get('username') || 'Anonymous',
                room: searchParams.get('room') || '1'
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