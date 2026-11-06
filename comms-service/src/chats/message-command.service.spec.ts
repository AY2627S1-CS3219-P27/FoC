import type { DataSource, EntityManager } from 'typeorm';
import { MessageCommandService } from './message-command.service.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const requesterId = '22222222-2222-4222-8222-222222222222';
const courierId = '33333333-3333-4333-8333-333333333333';
const clientMessageId = '44444444-4444-4444-8444-444444444444';
const messageId = '55555555-5555-4555-8555-555555555555';

describe('MessageCommandService', () => {
  const query = vi.fn();
  const transaction = vi.fn(
    async (
      _isolation: string,
      work: (manager: EntityManager) => Promise<unknown>,
    ) => work({ query } as unknown as EntityManager),
  );
  const service = new MessageCommandService({
    transaction,
  } as unknown as DataSource);
  const command = {
    chatId,
    senderUserId: requesterId,
    clientMessageId,
    content: 'hello',
  };
  const writableChat = {
    chat_id: chatId,
    requester_user_id: requesterId,
    courier_user_id: courierId,
    state: 'ACTIVE',
    writable: true,
    next_sequence: '1',
  };
  const storedMessage = {
    message_id: messageId,
    sequence: '1',
    sender_id: requesterId,
    content: 'hello',
    committed_at: new Date('2026-11-04T10:00:00.000Z'),
    read_at: null,
  };

  beforeEach(() => vi.clearAllMocks());

  it('locks, allocates, inserts unread, and updates chat ordering in one transaction', async () => {
    query
      .mockResolvedValueOnce([writableChat])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedMessage]);

    await expect(service.send(command)).resolves.toEqual({
      message: {
        messageId,
        sequence: 1,
        senderUserId: requesterId,
        content: 'hello',
        timestamp: '2026-11-04T10:00:00.000Z',
        status: 'UNREAD',
      },
      recipientUserId: courierId,
      inserted: true,
    });
    expect(transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(query.mock.calls[0]![0]).toContain('FOR UPDATE');
    expect(query.mock.calls[0]![1]).toEqual([chatId, requesterId]);
    expect(query.mock.calls[2]![0]).toContain('next_sequence + 1');
    expect(query.mock.calls[2]![0]).toContain('updated_at = now()');
    expect(query.mock.calls[3]![0]).toContain('INSERT INTO messages');
    expect(query.mock.calls[3]![1]).toEqual([
      expect.any(String),
      chatId,
      1,
      requesterId,
      clientMessageId,
      'hello',
    ]);
  });

  it('returns an identical retry with its stored status without writing', async () => {
    query
      .mockResolvedValueOnce([writableChat])
      .mockResolvedValueOnce([
        { ...storedMessage, read_at: '2026-11-04T10:01:00.000Z' },
      ]);

    await expect(service.send(command)).resolves.toMatchObject({
      message: { messageId, sequence: 1, status: 'READ' },
      recipientUserId: courierId,
      inserted: false,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects reuse of a retry identity with different content', async () => {
    query
      .mockResolvedValueOnce([writableChat])
      .mockResolvedValueOnce([storedMessage]);

    await expect(
      service.send({ ...command, content: 'different' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('conceals unknown and unauthorized chats before retry lookup', async () => {
    query.mockResolvedValueOnce([]);

    await expect(service.send(command)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'ARCHIVED', writable: false },
    { state: 'GRACE', writable: false },
  ])('rejects a non-writable chat before retry lookup', async (state) => {
    query.mockResolvedValueOnce([{ ...writableChat, ...state }]);

    await expect(service.send(command)).rejects.toMatchObject({
      code: 'CHAT_ARCHIVED',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an unsupported sequence', async () => {
    query
      .mockResolvedValueOnce([
        { ...writableChat, next_sequence: '9007199254740992' },
      ])
      .mockResolvedValueOnce([]);

    await expect(service.send(command)).rejects.toThrow(
      'Message sequence exceeds the supported protocol range',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
