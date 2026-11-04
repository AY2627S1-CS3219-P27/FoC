import { BadRequestException } from '@nestjs/common';
import { ChatCursorCodec } from './chat-cursor.codec.js';

describe('ChatCursorCodec', () => {
  const codec = new ChatCursorCodec();
  const chatId = '11111111-1111-4111-8111-111111111111';

  it('round trips endpoint-specific chat and message cursors', () => {
    const updatedAt = new Date('2026-11-04T01:02:03.456Z');
    expect(codec.decodeChat(codec.encodeChat(updatedAt, chatId))).toEqual({
      updatedAt,
      chatId,
    });
    expect(codec.decodeMessages(codec.encodeMessages(42))).toBe(42);
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
      codec.decodeMessages(codec.encodeChat(new Date(), chatId)),
    ).toThrow(BadRequestException);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects out-of-range message sequence %s',
    (sequence) => {
      expect(() => codec.encodeMessages(sequence)).toThrow(BadRequestException);
    },
  );
});
