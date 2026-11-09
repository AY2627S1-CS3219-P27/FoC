import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

const CHAT_CURSOR_VERSION = 2;
const LEGACY_MESSAGE_CURSOR_VERSION = 1;
const MESSAGE_CURSOR_VERSION = 2;
const ARCHIVE_CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;
const CURSOR_DOMAIN = 'foc.comms.cursor.v1\0';

type ChatCursorPayload = [typeof CHAT_CURSOR_VERSION, 'chats', string, string];
export type MessageHistoryDirection = 'forward' | 'backward';

type LegacyMessageCursorPayload = [
  typeof LEGACY_MESSAGE_CURSOR_VERSION,
  'messages',
  string,
];
type MessageCursorPayload = [
  typeof MESSAGE_CURSOR_VERSION,
  'messages',
  MessageHistoryDirection,
  string,
];
type ArchiveCursorPayload = [
  typeof ARCHIVE_CURSOR_VERSION,
  'archives',
  string,
  string,
];

export interface ChatCursor {
  updatedAt: string;
  chatId: string;
}

export interface ArchiveCursor {
  archivedAt: string;
  archiveId: string;
}

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_CURSOR',
    message: 'Cursor is invalid',
  });
}

function digest(encoded: string): string {
  return createHash('sha256')
    .update(CURSOR_DOMAIN)
    .update(encoded)
    .digest('hex');
}

function isExactTimestamp(value: string): boolean {
  const match = EXACT_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const milliseconds = `${match[1]}.${match[2].slice(0, 3)}Z`;
  const parsed = new Date(milliseconds);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === milliseconds
  );
}

function encode(
  payload:
    | ChatCursorPayload
    | LegacyMessageCursorPayload
    | MessageCursorPayload
    | ArchiveCursorPayload,
): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${encoded}.${digest(encoded)}`;
}

function decode(cursor: string): unknown {
  if (cursor.length > 512 || !CURSOR_PATTERN.test(cursor)) {
    throw invalidCursor();
  }
  const [encoded, checksum] = cursor.split('.');
  if (digest(encoded) !== checksum) {
    throw invalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) {
      throw invalidCursor();
    }
    return JSON.parse(decoded.toString('utf8'));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw invalidCursor();
  }
}

@Injectable()
export class ChatCursorCodec {
  encodeChat(updatedAt: string, chatId: string): string {
    if (!isExactTimestamp(updatedAt) || !UUID_PATTERN.test(chatId)) {
      throw invalidCursor();
    }
    return encode([CHAT_CURSOR_VERSION, 'chats', updatedAt, chatId]);
  }

  decodeChat(cursor: string): ChatCursor {
    const value = decode(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== CHAT_CURSOR_VERSION ||
      value[1] !== 'chats' ||
      typeof value[2] !== 'string' ||
      typeof value[3] !== 'string' ||
      !isExactTimestamp(value[2]) ||
      !UUID_PATTERN.test(value[3])
    ) {
      throw invalidCursor();
    }
    return { updatedAt: value[2], chatId: value[3] };
  }

  encodeArchive(archivedAt: string, archiveId: string): string {
    if (!isExactTimestamp(archivedAt) || !UUID_PATTERN.test(archiveId)) {
      throw invalidCursor();
    }
    return encode([ARCHIVE_CURSOR_VERSION, 'archives', archivedAt, archiveId]);
  }

  decodeArchive(cursor: string): ArchiveCursor {
    const value = decode(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== ARCHIVE_CURSOR_VERSION ||
      value[1] !== 'archives' ||
      typeof value[2] !== 'string' ||
      typeof value[3] !== 'string' ||
      !isExactTimestamp(value[2]) ||
      !UUID_PATTERN.test(value[3])
    ) {
      throw invalidCursor();
    }
    return { archivedAt: value[2], archiveId: value[3] };
  }

  encodeMessages(
    sequence: number,
    direction: MessageHistoryDirection = 'forward',
  ): string {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw invalidCursor();
    return encode([
      MESSAGE_CURSOR_VERSION,
      'messages',
      direction,
      String(sequence),
    ]);
  }

  decodeMessages(
    cursor: string,
    expectedDirection: MessageHistoryDirection = 'forward',
  ): number {
    const value = decode(cursor);
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value[0] === LEGACY_MESSAGE_CURSOR_VERSION &&
      value[1] === 'messages' &&
      typeof value[2] === 'string' &&
      /^[1-9]\d*$/.test(value[2]) &&
      expectedDirection === 'forward'
    ) {
      const sequence = Number(value[2]);
      if (!Number.isSafeInteger(sequence)) throw invalidCursor();
      return sequence;
    }
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== MESSAGE_CURSOR_VERSION ||
      value[1] !== 'messages' ||
      value[2] !== expectedDirection ||
      typeof value[3] !== 'string' ||
      !/^[1-9]\d*$/.test(value[3])
    ) {
      throw invalidCursor();
    }
    const sequence = Number(value[3]);
    if (!Number.isSafeInteger(sequence)) throw invalidCursor();
    return sequence;
  }
}
