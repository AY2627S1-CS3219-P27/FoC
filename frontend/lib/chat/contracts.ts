export type MessageStatus = "UNREAD" | "READ";
export type ChatState = "ACTIVE" | "GRACE";
export type ChatCloseReason = "ERRAND_DELIVERED" | "COURIER_CANCELLED" | "ERRAND_CANCELLED";
export type MessageHistoryDirection = "forward" | "backward";

export interface MessageView {
  messageId: string;
  sequence: number;
  senderUserId: string;
  content: string;
  timestamp: string;
  status: MessageStatus;
}

export interface ChatView {
  chatId: string;
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  state: ChatState;
  closesAt: string | null;
  closeReason: ChatCloseReason | null;
  updatedAt: string;
  lastMessage: MessageView | null;
  unread: boolean;
}

export interface CursorPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export type ChatListResponse = CursorPage<ChatView>;
export type MessageHistoryResponse = CursorPage<MessageView>;

export interface ArchiveListItem {
  archiveId: string;
  chatId: string;
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  archivedAt: string;
}

export interface ArchiveMessage {
  role: "REQUESTER" | "COURIER";
  content: string;
  timestamp: string;
}

export interface ArchiveDetail extends ArchiveListItem {
  schemaVersion: 1;
  messages: ArchiveMessage[];
}

export type ArchiveListResponse = CursorPage<ArchiveListItem>;

export interface ChatJoinData {
  chatId: string;
  state: ChatState;
  closesAt: string | null;
  closeReason: ChatCloseReason | null;
  latestSequence: number;
}

export interface MessagesReadData {
  chatId: string;
  throughSequence: number;
  highestReadSequence: number | null;
  readAt: string | null;
}

export interface MessagesReadReceipt extends MessagesReadData {
  readerUserId: string;
}

export interface ChatClosingEvent {
  chatId: string;
  closesAt: string;
  closeReason: ChatCloseReason;
}

export interface ChatArchivedEvent {
  chatId: string;
  archiveId: string;
  archivedAt: string;
}

export type ChatSocketErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_MESSAGE"
  | "CHAT_ARCHIVED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type ChatSocketAcknowledgement<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ChatSocketErrorCode; message: string };
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOSE_REASONS = new Set<ChatCloseReason>(["ERRAND_DELIVERED", "COURIER_CANCELLED", "ERRAND_CANCELLED"]);
const SOCKET_ERROR_CODES = new Set<ChatSocketErrorCode>([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_REQUEST",
  "INVALID_MESSAGE",
  "CHAT_ARCHIVED",
  "CONFLICT",
  "INTERNAL_ERROR",
]);

export class ChatContractError extends Error {
  constructor() {
    super("Communication Service response is invalid");
    this.name = "ChatContractError";
  }
}

function invalid(): never {
  throw new ChatContractError();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const candidate = record(value);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return invalid();
  }
  return candidate;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}

function uuid(value: unknown): string {
  const parsed = string(value);
  return UUID_PATTERN.test(parsed) ? parsed : invalid();
}

function timestamp(value: unknown): string {
  const parsed = string(value);
  const date = new Date(parsed);
  return !Number.isNaN(date.getTime()) && date.toISOString() === parsed ? parsed : invalid();
}

function positiveSequence(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : invalid();
}

function nonNegativeSequence(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : invalid();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function closeReason(value: unknown): ChatCloseReason {
  return typeof value === "string" && CLOSE_REASONS.has(value as ChatCloseReason)
    ? (value as ChatCloseReason)
    : invalid();
}

function nullableCloseReason(value: unknown): ChatCloseReason | null {
  return value === null ? null : closeReason(value);
}

function parseCursorPage<T>(value: unknown, parseItem: (item: unknown) => T): CursorPage<T> {
  const page = exact(value, ["items", "hasMore", "nextCursor"]);
  if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
    return invalid();
  }
  const nextCursor = page.nextCursor === null ? null : string(page.nextCursor);
  if (page.hasMore !== (nextCursor !== null)) return invalid();
  return {
    items: page.items.map(parseItem),
    hasMore: page.hasMore,
    nextCursor,
  };
}

export function parseMessageView(value: unknown): MessageView {
  const message = exact(value, ["messageId", "sequence", "senderUserId", "content", "timestamp", "status"]);
  const status = message.status;
  if (status !== "UNREAD" && status !== "READ") return invalid();
  return {
    messageId: uuid(message.messageId),
    sequence: positiveSequence(message.sequence),
    senderUserId: uuid(message.senderUserId),
    content: string(message.content),
    timestamp: timestamp(message.timestamp),
    status,
  };
}

export function parseChatView(value: unknown): ChatView {
  const chat = exact(value, [
    "chatId",
    "errandId",
    "requesterUserId",
    "courierUserId",
    "state",
    "closesAt",
    "closeReason",
    "updatedAt",
    "lastMessage",
    "unread",
  ]);
  if ((chat.state !== "ACTIVE" && chat.state !== "GRACE") || typeof chat.unread !== "boolean") {
    return invalid();
  }
  const closesAt = nullableTimestamp(chat.closesAt);
  const reason = nullableCloseReason(chat.closeReason);
  if (
    (chat.state === "ACTIVE" && (closesAt !== null || reason !== null)) ||
    (chat.state === "GRACE" && (closesAt === null || reason === null))
  ) {
    return invalid();
  }
  return {
    chatId: uuid(chat.chatId),
    errandId: uuid(chat.errandId),
    requesterUserId: uuid(chat.requesterUserId),
    courierUserId: uuid(chat.courierUserId),
    state: chat.state,
    closesAt,
    closeReason: reason,
    updatedAt: timestamp(chat.updatedAt),
    lastMessage: chat.lastMessage === null ? null : parseMessageView(chat.lastMessage),
    unread: chat.unread,
  };
}

export function parseChatListResponse(value: unknown): ChatListResponse {
  return parseCursorPage(value, parseChatView);
}

export function parseMessageHistoryResponse(value: unknown): MessageHistoryResponse {
  const page = parseCursorPage(value, parseMessageView);
  for (let index = 1; index < page.items.length; index += 1) {
    if (page.items[index - 1]!.sequence >= page.items[index]!.sequence) {
      return invalid();
    }
  }
  return page;
}

export function parseArchiveListItem(value: unknown): ArchiveListItem {
  const archive = exact(value, ["archiveId", "chatId", "errandId", "requesterUserId", "courierUserId", "archivedAt"]);
  return {
    archiveId: uuid(archive.archiveId),
    chatId: uuid(archive.chatId),
    errandId: uuid(archive.errandId),
    requesterUserId: uuid(archive.requesterUserId),
    courierUserId: uuid(archive.courierUserId),
    archivedAt: timestamp(archive.archivedAt),
  };
}

export function parseArchiveListResponse(value: unknown): ArchiveListResponse {
  return parseCursorPage(value, parseArchiveListItem);
}

function parseArchiveMessage(value: unknown): ArchiveMessage {
  const message = exact(value, ["role", "content", "timestamp"]);
  if (message.role !== "REQUESTER" && message.role !== "COURIER") {
    return invalid();
  }
  return {
    role: message.role,
    content: string(message.content),
    timestamp: timestamp(message.timestamp),
  };
}

export function parseArchiveDetail(value: unknown): ArchiveDetail {
  const archive = exact(value, [
    "archiveId",
    "chatId",
    "errandId",
    "requesterUserId",
    "courierUserId",
    "archivedAt",
    "schemaVersion",
    "messages",
  ]);
  if (archive.schemaVersion !== 1 || !Array.isArray(archive.messages)) {
    return invalid();
  }
  const listItem = parseArchiveListItem({
    archiveId: archive.archiveId,
    chatId: archive.chatId,
    errandId: archive.errandId,
    requesterUserId: archive.requesterUserId,
    courierUserId: archive.courierUserId,
    archivedAt: archive.archivedAt,
  });
  return {
    ...listItem,
    schemaVersion: 1,
    messages: archive.messages.map(parseArchiveMessage),
  };
}

export function parseChatJoinData(value: unknown): ChatJoinData {
  const join = exact(value, ["chatId", "state", "closesAt", "closeReason", "latestSequence"]);
  if (join.state !== "ACTIVE" && join.state !== "GRACE") return invalid();
  const closesAt = nullableTimestamp(join.closesAt);
  const reason = nullableCloseReason(join.closeReason);
  if (
    (join.state === "ACTIVE" && (closesAt !== null || reason !== null)) ||
    (join.state === "GRACE" && (closesAt === null || reason === null))
  ) {
    return invalid();
  }
  return {
    chatId: uuid(join.chatId),
    state: join.state,
    closesAt,
    closeReason: reason,
    latestSequence: nonNegativeSequence(join.latestSequence),
  };
}

export function parseMessagesReadData(value: unknown): MessagesReadData {
  const read = exact(value, ["chatId", "throughSequence", "highestReadSequence", "readAt"]);
  const highestReadSequence = read.highestReadSequence === null ? null : positiveSequence(read.highestReadSequence);
  return {
    chatId: uuid(read.chatId),
    throughSequence: positiveSequence(read.throughSequence),
    highestReadSequence,
    readAt: nullableTimestamp(read.readAt),
  };
}

export function parseMessagesReadReceipt(value: unknown): MessagesReadReceipt {
  const receipt = exact(value, ["chatId", "throughSequence", "highestReadSequence", "readAt", "readerUserId"]);
  return {
    ...parseMessagesReadData({
      chatId: receipt.chatId,
      throughSequence: receipt.throughSequence,
      highestReadSequence: receipt.highestReadSequence,
      readAt: receipt.readAt,
    }),
    readerUserId: uuid(receipt.readerUserId),
  };
}

export function parseChatClosingEvent(value: unknown): ChatClosingEvent {
  const event = exact(value, ["chatId", "closesAt", "closeReason"]);
  return {
    chatId: uuid(event.chatId),
    closesAt: timestamp(event.closesAt),
    closeReason: closeReason(event.closeReason),
  };
}

export function parseChatArchivedEvent(value: unknown): ChatArchivedEvent {
  const event = exact(value, ["chatId", "archiveId", "archivedAt"]);
  return {
    chatId: uuid(event.chatId),
    archiveId: uuid(event.archiveId),
    archivedAt: timestamp(event.archivedAt),
  };
}

export function parseChatSocketAcknowledgement<T>(
  value: unknown,
  parseData: (data: unknown) => T
): ChatSocketAcknowledgement<T> {
  const acknowledgement = record(value);
  if (acknowledgement.ok === true) {
    const success = exact(value, ["ok", "data"]);
    return { ok: true, data: parseData(success.data) };
  }
  if (acknowledgement.ok !== false) return invalid();
  const failure = exact(value, ["ok", "error"]);
  const error = exact(failure.error, ["code", "message"]);
  if (typeof error.code !== "string" || !SOCKET_ERROR_CODES.has(error.code as ChatSocketErrorCode)) {
    return invalid();
  }
  return {
    ok: false,
    error: {
      code: error.code as ChatSocketErrorCode,
      message: string(error.message),
    },
  };
}
