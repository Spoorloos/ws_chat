import type { ServerWebSocket } from "bun";

type WSServer = ServerWebSocket<WSData>;
type OneOrMore<T = unknown> = [ T, ...T[] ];
type AnyFunction = (...args: any[]) => any;

type WSData = Readonly<{
    userID: string;
    userName: string;
    roomName: string;
}>

type Message = {
    content: string;
    iv: string;
}

type Messages = Record<string, Message>;
type ExchangeKeys = Record<string, string>;

type User = {
    name: string;
    key: string;
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

type SafeCallResult<T> = Readonly<
    | [ success: true, returned: T ]
    | [ success: false, error: any ]
>