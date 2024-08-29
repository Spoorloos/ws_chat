import type { ServerWebSocket } from 'bun';

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
    [targetUuid: string]: Message
}

interface MessageData {
    readonly type: 'message' | 'exchange' | 'server' | 'keyinit',
    [key: string]: any;
}

interface KeyExchangeData {
    readonly [uuid: string]: string
}