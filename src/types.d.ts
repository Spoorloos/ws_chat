import type { ServerWebSocket } from "bun";

type WsData = {
    uuid: string;
    username: string;
    room: string;
}

type CustomWebSocket = ServerWebSocket<WsData>

type Message = {
    content: string;
    iv: string;
}

type Messages = {
    [targetUuid: string]: Message;
}

type ExchangeKeys = {
    [uuid: string]: string;
}

// Message Data Types
type MessageCaseData = {
    readonly type: "message";
    sender: string;
    uuid: string;
    content: string;
    iv: string;
}

type SendMessageCaseData = {
    readonly type: "send_message";
    messages?: Messages;
}

type ExchangeCaseData = {
    readonly type: "exchange";
    uuid: string;
    key: string;
}

type SendExchangeCaseData = {
    readonly type: "send_exchange";
    key?: string;
}

type AnnouncementCaseData = {
    readonly type: "announcement";
    content: string;
}

type KeyInitCaseData = {
    readonly type: "keyinit";
    keys: ExchangeKeys;
}

type MessageData =
    | MessageCaseData
    | SendMessageCaseData
    | ExchangeCaseData
    | SendExchangeCaseData
    | AnnouncementCaseData
    | KeyInitCaseData;

type SafeCallResult<T> =
    | [ success: true, returned: T ]
    | [ success: false, error: any ];