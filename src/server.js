// src/server.ts
function colorText(color, ...text) {
  return `\x1B[${color}m${text.join(" ")}\x1B[0m`;
}
function log(...message) {
  console.log(colorText(90 /* Gray */, new Date().toLocaleTimeString()), ...message);
}
function logError(error) {
  log(colorText(91 /* Red */, "The server encountered an error:"));
  console.error(error);
}
function sendToRoom(room, data) {
  server.publish(room, JSON.stringify(data));
}
function sendToClient(client, data) {
  client.send(JSON.stringify(data));
}
async function loadFileIfExists(path) {
  const file = Bun.file(path);
  return await file.exists() ? file : undefined;
}
function safeCall(callback, ...args) {
  try {
    return [true, callback.apply(this, args)];
  } catch (error) {
    return [false, error];
  }
}
function wrapInErrorHandler(callback) {
  return function(...args) {
    try {
      return callback.apply(this, args);
    } catch (error) {
      logError(error);
    }
  }.bind(this);
}
function handleOpen(ws) {
  const { username, room, uuid } = ws.data;
  ws.subscribe(room);
  sockets.set(uuid, ws);
  if (!roomClientKeys.has(room)) {
    roomClientKeys.set(room, new Map);
  }
  sendToRoom(room, {
    type: "announcement",
    content: `${username} has joined the room!`
  });
  sendToClient(ws, {
    type: "keyinit",
    keys: Object.fromEntries(roomClientKeys.get(room))
  });
  log(`${username} joined room "${room}"`);
}
function handleClose(ws) {
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
    content: `${username} has left the room!`
  });
  log(`${username} left room "${room}"`);
}
function getMessageLength(encrypted) {
  return atob(encrypted).length - 16;
}
function isMessage(message) {
  return message !== null && typeof message === "object" && typeof message.content === "string" && typeof message.iv === "string";
}
function handleUserMessage(data, messages) {
  for (const [targetUuid, message] of Object.entries(messages)) {
    if (typeof targetUuid !== "string" || !isMessage(message))
      continue;
    const ws = sockets.get(targetUuid);
    if (!ws)
      continue;
    const length = getMessageLength(message.content);
    if (length <= 0 || length > 256)
      continue;
    sendToClient(ws, {
      type: "message",
      sender: data.username,
      uuid: data.uuid,
      content: message.content,
      iv: message.iv
    });
  }
  log(`${data.username} sent a message in room "${data.room}"`);
}
function handleExchange(data, key) {
  const keys = roomClientKeys.get(data.room);
  if (!keys || keys.has(data.uuid))
    return;
  keys.set(data.uuid, key);
  sendToRoom(data.room, {
    type: "exchange",
    uuid: data.uuid,
    key
  });
}
function isMessageData(data) {
  return data !== null && typeof data === "object" && typeof data.type === "string";
}
function handleMessage(ws, received) {
  const [success, data] = safeCall(JSON.parse, received);
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
function upgradeSocket(request, searchParams) {
  const username = searchParams.get("username") || "Anonymous";
  const room = searchParams.get("room");
  if (username.length > 16 || !room || room.length > 32) {
    return new Response("Invalid data sent", { status: 400 });
  }
  const data = {
    uuid: crypto.randomUUID(),
    username,
    room
  };
  if (!server.upgrade(request, { data })) {
    return new Response("Upgrade failed", { status: 500 });
  }
}
async function handleFetch(request) {
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
function handleError(error) {
  logError(error);
  return new Response(`The server encountered an error! "${error}"`, {
    status: 500
  });
}
var sockets = new Map;
var roomClientKeys = new Map;
var server = Bun.serve({
  development: false,
  fetch: handleFetch,
  error: handleError,
  websocket: {
    open: wrapInErrorHandler(handleOpen),
    close: wrapInErrorHandler(handleClose),
    message: wrapInErrorHandler(handleMessage)
  },
  tls: {
    cert: await loadFileIfExists("./certs/" + Bun.env.CERT),
    key: await loadFileIfExists("./certs/" + Bun.env.KEY),
    passphrase: Bun.env.PASSPHRASE
  }
});
console.log("Server started at " + colorText(94 /* Blue */, server.url));
