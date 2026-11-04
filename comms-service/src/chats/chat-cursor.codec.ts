import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

const CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_DOMAIN = 'foc.comms.cursor.v1\0';

type ChatCursorPayload = [typeof CURSOR_VERSION, 'chats', string, string];
type MessageCursorPayload = [typeof CURSOR_VERSION, 'messages', string];

export interface ChatCursor {
  updatedAt: Date;
  chatId: string;
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

function encode(payload: ChatCursorPayload | MessageCursorPayload): string {
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
  encodeChat(updatedAt: Date, chatId: string): string {
    return encode([CURSOR_VERSION, 'chats', updatedAt.toISOString(), chatId]);
  }

  decodeChat(cursor: string): ChatCursor {
    const value = decode(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 4 ||
      value[0] !== CURSOR_VERSION ||
      value[1] !== 'chats' ||
      typeof value[2] !== 'string' ||
      typeof value[3] !== 'string' ||
      !UUID_PATTERN.test(value[3])
    ) {
      throw invalidCursor();
    }
    const updatedAt = new Date(value[2]);
    if (
      Number.isNaN(updatedAt.getTime()) ||
      updatedAt.toISOString() !== value[2]
    ) {
      throw invalidCursor();
    }
    return { updatedAt, chatId: value[3] };
  }

  encodeMessages(sequence: number): string {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw invalidCursor();
    return encode([CURSOR_VERSION, 'messages', String(sequence)]);
  }

  decodeMessages(cursor: string): number {
    const value = decode(cursor);
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== CURSOR_VERSION ||
      value[1] !== 'messages' ||
      typeof value[2] !== 'string' ||
      !/^[1-9]\d*$/.test(value[2])
    ) {
      throw invalidCursor();
    }
    const sequence = Number(value[2]);
    if (!Number.isSafeInteger(sequence)) throw invalidCursor();
    return sequence;
  }
}
