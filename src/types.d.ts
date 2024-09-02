import type { ServerWebSocket } from 'bun';

interface WsData {
    uuid: string;
    username: string;
    room: string;
}

interface CustomWebSocket extends ServerWebSocket<unknown> {
    data: WsData;
}

interface Message {
    content: string,
    iv: string
}

interface Messages {
    [targetUuid: string]: Message
}

interface ExchangeKeys {
    [uuid: string]: string;
}

// Message Data Types
interface MessageCaseData {
    readonly type: 'message';
    sender: string;
    uuid: string;
    content: string;
    iv: string;
}

interface SendMessageCaseData {
    readonly type: 'send_message';
    messages?: Messages;
}

interface ExchangeCaseData {
    readonly type: 'exchange';
    uuid: string;
    key: string;
}

interface SendExchangeCaseData {
    readonly type: 'send_exchange';
    key?: string;
}

interface AnnouncementCaseData {
    readonly type: 'announcement';
    content: string;
}

interface KeyInitCaseData {
    readonly type: 'keyinit';
    keys: ExchangeKeys;
}

type MessageData =
    | MessageCaseData
    | SendMessageCaseData
    | ExchangeCaseData
    | SendExchangeCaseData
    | AnnouncementCaseData
    | KeyInitCaseData;