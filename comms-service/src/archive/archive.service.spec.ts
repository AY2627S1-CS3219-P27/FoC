import type { DataSource, EntityManager } from 'typeorm';
import { ArchiveService, buildArchiveSnapshot } from './archive.service.js';

const chat = {
  chat_id: '11111111-1111-4111-8111-111111111111',
  errand_id: '22222222-2222-4222-8222-222222222222',
  requester_user_id: '33333333-3333-4333-8333-333333333333',
  courier_user_id: '44444444-4444-4444-8444-444444444444',
  state: 'GRACE',
  closes_at: new Date('2026-11-06T09:00:00.000Z'),
  archive_id: null,
  archive_claim_expires_at: new Date('2026-11-06T10:01:00.000Z'),
} as const;
const claim = {
  chatId: chat.chat_id,
  claimToken: '55555555-5555-4555-8555-555555555555',
  reclaimed: false,
};

describe('ArchiveService', () => {
  const query = vi.fn();
  const transaction = vi.fn(
    async (
      _isolation: string,
      work: (manager: EntityManager) => Promise<unknown>,
    ) => work({ query } as unknown as EntityManager),
  );
  const service = new ArchiveService({
    transaction,
  } as unknown as DataSource);

  beforeEach(() => vi.clearAllMocks());

  it('creates, deletes, and links one ordered snapshot transactionally', async () => {
    query
      .mockResolvedValueOnce([chat])
      .mockResolvedValueOnce([
        { archived_at: new Date('2026-11-06T10:00:00.000Z') },
      ])
      .mockResolvedValueOnce([
        {
          sender_id: chat.requester_user_id,
          content: 'requester message',
          committed_at: new Date('2026-11-06T09:10:00.000Z'),
        },
        {
          sender_id: chat.courier_user_id,
          content: 'courier message',
          committed_at: new Date('2026-11-06T09:11:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async (_sql: string, values: unknown[]) => [
        { chat_id: values[0] },
      ]);

    const result = await service.archive(claim);

    expect(result).toMatchObject({
      status: 'archived',
      notification: {
        chatId: chat.chat_id,
        requesterUserId: chat.requester_user_id,
        courierUserId: chat.courier_user_id,
        archivedAt: new Date('2026-11-06T10:00:00.000Z'),
      },
    });
    expect(query.mock.calls[0]![0]).toContain('FOR UPDATE');
    expect(query.mock.calls[2]![0]).toContain('ORDER BY message.sequence ASC');
    const snapshot = JSON.parse(query.mock.calls[3]![1][6] as string);
    expect(snapshot).toEqual({
      schemaVersion: 1,
      chatId: chat.chat_id,
      errandId: chat.errand_id,
      requesterUserId: chat.requester_user_id,
      courierUserId: chat.courier_user_id,
      archivedAt: '2026-11-06T10:00:00.000Z',
      messages: [
        {
          role: 'REQUESTER',
          content: 'requester message',
          timestamp: '2026-11-06T09:10:00.000Z',
        },
        {
          role: 'COURIER',
          content: 'courier message',
          timestamp: '2026-11-06T09:11:00.000Z',
        },
      ],
    });
    expect(query.mock.calls[4]![0]).toContain('DELETE FROM messages');
    expect(query.mock.calls[5]![0]).toContain("state = 'ARCHIVED'");
  });

  it('treats missing, expired, and no-longer-due claims as stale', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.archive(claim)).resolves.toEqual({ status: 'stale' });

    vi.clearAllMocks();
    query
      .mockResolvedValueOnce([chat])
      .mockResolvedValueOnce([
        { archived_at: new Date('2026-11-06T10:02:00.000Z') },
      ]);
    await expect(service.archive(claim)).resolves.toEqual({ status: 'stale' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects a message whose sender is not a participant', () => {
    expect(() =>
      buildArchiveSnapshot(chat, new Date('2026-11-06T10:00:00.000Z'), [
        {
          sender_id: '66666666-6666-4666-8666-666666666666',
          content: 'invalid sender',
          committed_at: new Date('2026-11-06T09:10:00.000Z'),
        },
      ]),
    ).toThrow('Archived message sender is not a chat participant');
  });

  it('builds a valid immutable snapshot for an empty chat', () => {
    expect(
      buildArchiveSnapshot(chat, new Date('2026-11-06T10:00:00.000Z'), []),
    ).toMatchObject({
      schemaVersion: 1,
      chatId: chat.chat_id,
      archivedAt: '2026-11-06T10:00:00.000Z',
      messages: [],
    });
  });
});
