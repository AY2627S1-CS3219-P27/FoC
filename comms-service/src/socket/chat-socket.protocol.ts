import type { CommittedMessageDto } from '../chats/message-command.types.js';
import type {
  MessagesReadData,
  MessagesReadReceipt,
} from '../chats/read-command.types.js';
import type { ChatCloseReason } from '../database/entities/chat.entity.js';

export const CHAT_NAMESPACE = '/chat';
export const CHAT_SOCKET_MAX_HTTP_BUFFER_BYTES = 32 * 1024;

export type ChatSocketErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_MESSAGE'
  | 'CHAT_ARCHIVED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface ChatSocketFailure {
  ok: false;
  error: {
    code: ChatSocketErrorCode;
    message: string;
  };
}

export type ChatSocketAcknowledgement<T> =
  { ok: true; data: T } | ChatSocketFailure;

export interface ChatJoinPayload {
  chatId: string;
}

export interface MessageSendPayload {
  chatId: string;
  clientMessageId: string;
  content: string;
}

export interface MessagesReadPayload {
  chatId: string;
  throughSequence: number;
}

export interface ChatJoinData {
  chatId: string;
  state: 'ACTIVE' | 'GRACE';
  closesAt: string | null;
  closeReason:
    'ERRAND_DELIVERED' | 'COURIER_CANCELLED' | 'ERRAND_CANCELLED' | null;
  latestSequence: number;
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

export interface ChatServerEvents {
  'message:new': (message: CommittedMessageDto) => void;
  'messages:read-receipt': (receipt: MessagesReadReceipt) => void;
  'chat:closing': (event: ChatClosingEvent) => void;
  'chat:archived': (event: ChatArchivedEvent) => void;
}

export type MessageSendData = CommittedMessageDto;
export type { MessagesReadData, MessagesReadReceipt };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ERROR_MESSAGES: Record<ChatSocketErrorCode, string> = {
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Operation not allowed',
  NOT_FOUND: 'Chat not found',
  INVALID_REQUEST: 'Invalid request',
  INVALID_MESSAGE: 'Invalid message',
  CHAT_ARCHIVED: 'Chat is archived',
  CONFLICT: 'Request conflicts with current socket state',
  INTERNAL_ERROR: 'Unable to complete request',
};

export class ChatSocketError extends Error {
  constructor(readonly code: ChatSocketErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}

export function chatSocketFailure(
  error: ChatSocketError | ChatSocketErrorCode,
): ChatSocketFailure {
  const code = typeof error === 'string' ? error : error.code;
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
}

export function parseChatJoinPayload(payload: unknown): ChatJoinPayload {
  const record = strictRecord(payload, ['chatId']);
  if (!isUuid(record.chatId)) throw new ChatSocketError('INVALID_REQUEST');
  return { chatId: record.chatId };
}

export function parseMessageSendPayload(payload: unknown): MessageSendPayload {
  const record = strictRecord(payload, [
    'chatId',
    'clientMessageId',
    'content',
  ]);
  if (!isUuid(record.chatId) || !isUuid(record.clientMessageId)) {
    throw new ChatSocketError('INVALID_REQUEST');
  }
  if (
    typeof record.content !== 'string' ||
    record.content.trim().length === 0 ||
    // The protocol limit is Unicode code points, not grapheme clusters.
    // oxlint-disable-next-line typescript/no-misused-spread
    [...record.content].length > 4_000
  ) {
    throw new ChatSocketError('INVALID_MESSAGE');
  }
  return {
    chatId: record.chatId,
    clientMessageId: record.clientMessageId,
    content: record.content,
  };
}

export function parseMessagesReadPayload(
  payload: unknown,
): MessagesReadPayload {
  const record = strictRecord(payload, ['chatId', 'throughSequence']);
  if (
    !isUuid(record.chatId) ||
    !Number.isSafeInteger(record.throughSequence) ||
    (record.throughSequence as number) < 1
  ) {
    throw new ChatSocketError('INVALID_REQUEST');
  }
  return {
    chatId: record.chatId,
    throughSequence: record.throughSequence as number,
  };
}

function strictRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ChatSocketError('INVALID_REQUEST');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new ChatSocketError('INVALID_REQUEST');
  }
  return record;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
