import {
  ChatSocketError,
  chatSocketFailure,
  parseChatJoinPayload,
  parseMessageSendPayload,
  parseMessagesReadPayload,
} from './chat-socket.protocol.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const clientMessageId = '22222222-2222-4222-8222-222222222222';

describe('chat socket protocol', () => {
  it('accepts strict join, send, and read payloads', () => {
    expect(parseChatJoinPayload({ chatId })).toEqual({ chatId });
    expect(
      parseMessageSendPayload({ chatId, clientMessageId, content: 'hello' }),
    ).toEqual({ chatId, clientMessageId, content: 'hello' });
    expect(parseMessagesReadPayload({ chatId, throughSequence: 3 })).toEqual({
      chatId,
      throughSequence: 3,
    });
  });

  it.each([
    undefined,
    null,
    [],
    { chatId: 'not-a-uuid' },
    { chatId, extra: true },
  ])('rejects an invalid join payload', (payload) => {
    expect(() => parseChatJoinPayload(payload)).toThrowError(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it('separates structural send errors from invalid message content', () => {
    expect(() =>
      parseMessageSendPayload({
        chatId,
        clientMessageId,
        content: 'ok',
        extra: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      parseMessageSendPayload({ chatId, clientMessageId, content: '   ' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MESSAGE' }));
    expect(() =>
      parseMessageSendPayload({
        chatId,
        clientMessageId,
        content: '😀'.repeat(4_001),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MESSAGE' }));
    expect(
      parseMessageSendPayload({
        chatId,
        clientMessageId,
        content: '😀'.repeat(4_000),
      }).content,
    ).toHaveLength(8_000);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid through-sequences',
    (throughSequence) => {
      expect(() =>
        parseMessagesReadPayload({ chatId, throughSequence }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    },
  );

  it('maps only stable sanitized errors into acknowledgements', () => {
    expect(chatSocketFailure(new ChatSocketError('NOT_FOUND'))).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Chat not found' },
    });
    expect(chatSocketFailure('INTERNAL_ERROR')).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to complete request',
      },
    });
  });
});
