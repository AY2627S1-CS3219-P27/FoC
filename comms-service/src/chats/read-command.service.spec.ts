import type { DataSource, EntityManager } from 'typeorm';
import { ReadCommandService } from './read-command.service.js';

const chatId = '11111111-1111-4111-8111-111111111111';
const requesterId = '22222222-2222-4222-8222-222222222222';
const courierId = '33333333-3333-4333-8333-333333333333';

describe('ReadCommandService', () => {
  const query = vi.fn();
  const transaction = vi.fn(
    async (
      _isolation: string,
      work: (manager: EntityManager) => Promise<unknown>,
    ) => work({ query } as unknown as EntityManager),
  );
  const service = new ReadCommandService({
    transaction,
  } as unknown as DataSource);
  const command = {
    chatId,
    readerUserId: requesterId,
    throughSequence: 3,
  };
  const liveChat = {
    requester_user_id: requesterId,
    courier_user_id: courierId,
    state: 'ACTIVE',
    writable: true,
    latest_sequence: '4',
  };

  beforeEach(() => vi.clearAllMocks());

  it('locks the chat and marks only the other participant through the sequence', async () => {
    query.mockResolvedValueOnce([liveChat]).mockResolvedValueOnce([
      {
        highest_read_sequence: '3',
        read_at: new Date('2026-11-05T01:00:00.000Z'),
      },
    ]);

    await expect(service.markRead(command)).resolves.toEqual({
      data: {
        chatId,
        throughSequence: 3,
        highestReadSequence: 3,
        readAt: '2026-11-05T01:00:00.000Z',
      },
      affectedSenderUserId: courierId,
      changed: true,
    });
    expect(transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(query.mock.calls[0]![0]).toContain('FOR UPDATE');
    expect(query.mock.calls[0]![0]).toContain('WITH locked AS MATERIALIZED');
    expect(query.mock.calls[0]![0]).toContain('clock_timestamp() < closes_at');
    expect(query.mock.calls[0]![1]).toEqual([chatId, requesterId]);
    expect(query.mock.calls[1]![0]).toContain('statement_timestamp()');
    expect(query.mock.calls[1]![0]).toContain('message.read_at IS NULL');
    expect(query.mock.calls[1]![1]).toEqual([chatId, courierId, 3]);
  });

  it('returns stable null metadata for an idempotent no-op', async () => {
    query
      .mockResolvedValueOnce([liveChat])
      .mockResolvedValueOnce([{ highest_read_sequence: null, read_at: null }]);

    await expect(service.markRead(command)).resolves.toEqual({
      data: {
        chatId,
        throughSequence: 3,
        highestReadSequence: null,
        readAt: null,
      },
      affectedSenderUserId: courierId,
      changed: false,
    });
  });

  it('routes courier reads back to the requester', async () => {
    query
      .mockResolvedValueOnce([liveChat])
      .mockResolvedValueOnce([
        { highest_read_sequence: '2', read_at: '2026-11-05T01:00:00.000Z' },
      ]);

    await expect(
      service.markRead({ ...command, readerUserId: courierId }),
    ).resolves.toMatchObject({ affectedSenderUserId: requesterId });
    expect(query.mock.calls[1]![1]).toEqual([chatId, requesterId, 3]);
  });

  it('conceals unknown and unauthorized chats', async () => {
    query.mockResolvedValueOnce([]);

    await expect(service.markRead(command)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'ARCHIVED', writable: false },
    { state: 'GRACE', writable: false },
  ])('rejects a non-writable chat before updating messages', async (state) => {
    query.mockResolvedValueOnce([{ ...liveChat, ...state }]);

    await expect(service.markRead(command)).rejects.toMatchObject({
      code: 'CHAT_ARCHIVED',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a sequence beyond the latest committed message', async () => {
    query.mockResolvedValueOnce([{ ...liveChat, latest_sequence: '2' }]);

    await expect(service.markRead(command)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the stored sequence exceeds the protocol range', async () => {
    query.mockResolvedValueOnce([
      { ...liveChat, latest_sequence: '9007199254740992' },
    ]);

    await expect(service.markRead(command)).rejects.toThrow(
      'Chat sequence exceeds the supported protocol range',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
