import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ChatCursorCodec } from './chat-cursor.codec.js';

function cursor(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const checksum = createHash('sha256')
    .update('foc.comms.cursor.v1\0')
    .update(encoded)
    .digest('hex');
  return `${encoded}.${checksum}`;
}

describe('ChatCursorCodec', () => {
  const codec = new ChatCursorCodec();
  const chatId = '11111111-1111-4111-8111-111111111111';
  const archiveId = '22222222-2222-4222-8222-222222222222';

  it('round trips endpoint-specific chat, archive, and message cursors', () => {
    const updatedAt = '2026-11-04T01:02:03.456789Z';
    expect(codec.decodeChat(codec.encodeChat(updatedAt, chatId))).toEqual({
      updatedAt,
      chatId,
    });
    expect(
      codec.decodeArchive(codec.encodeArchive(updatedAt, archiveId)),
    ).toEqual({ archivedAt: updatedAt, archiveId });
    expect(codec.decodeMessages(codec.encodeMessages(42))).toBe(42);
    expect(
      codec.decodeMessages(codec.encodeMessages(42, 'backward'), 'backward'),
    ).toBe(42);
  });

  it.each([
    '',
    'not-base64',
    `${Buffer.from('[1,"messages","1"]').toString('base64url')}.${'0'.repeat(64)}`,
  ])('rejects malformed or modified cursor %j', (cursor) => {
    expect(() => codec.decodeChat(cursor)).toThrow(BadRequestException);
  });

  it('rejects a cursor created for the other endpoint', () => {
    expect(() => codec.decodeChat(codec.encodeMessages(1))).toThrow(
      BadRequestException,
    );
    expect(() =>
      codec.decodeMessages(
        codec.encodeChat('2026-11-04T01:02:03.456789Z', chatId),
      ),
    ).toThrow(BadRequestException);
    expect(() => codec.decodeArchive(codec.encodeMessages(1))).toThrow(
      BadRequestException,
    );
    expect(() =>
      codec.decodeChat(
        codec.encodeArchive('2026-11-04T01:02:03.456789Z', archiveId),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a message cursor created for the other direction', () => {
    expect(() =>
      codec.decodeMessages(codec.encodeMessages(42, 'forward'), 'backward'),
    ).toThrow(BadRequestException);
    expect(() =>
      codec.decodeMessages(codec.encodeMessages(42, 'backward'), 'forward'),
    ).toThrow(BadRequestException);
  });

  it('accepts legacy message cursors only for forward paging', () => {
    const legacy = cursor([1, 'messages', '42']);
    expect(codec.decodeMessages(legacy, 'forward')).toBe(42);
    expect(() => codec.decodeMessages(legacy, 'backward')).toThrow(
      BadRequestException,
    );
  });

  it.each([
    '2026-11-04T01:02:03.456Z',
    '2026-11-04T01:02:03.456789+00:00',
    '2026-02-30T01:02:03.456789Z',
    '2026-11-04T25:02:03.456789Z',
  ])('rejects non-canonical chat timestamp %s', (updatedAt) => {
    expect(() => codec.encodeChat(updatedAt, chatId)).toThrow(
      BadRequestException,
    );
    expect(() =>
      codec.decodeChat(cursor([2, 'chats', updatedAt, chatId])),
    ).toThrow(BadRequestException);
  });

  it('rejects old chat versions and malformed chat IDs', () => {
    const updatedAt = '2026-11-04T01:02:03.456789Z';
    expect(() =>
      codec.decodeChat(cursor([1, 'chats', updatedAt, chatId])),
    ).toThrow(BadRequestException);
    expect(() =>
      codec.decodeChat(cursor([2, 'chats', updatedAt, 'not-a-uuid'])),
    ).toThrow(BadRequestException);
    expect(() => codec.encodeChat(updatedAt, 'not-a-uuid')).toThrow(
      BadRequestException,
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects out-of-range message sequence %s',
    (sequence) => {
      expect(() => codec.encodeMessages(sequence)).toThrow(BadRequestException);
    },
  );
});
