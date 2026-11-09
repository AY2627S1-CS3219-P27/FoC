import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.js';
import { ArchiveClaimService } from './archive-claim.service.js';

describe('ArchiveClaimService', () => {
  const query = vi.fn();
  const transaction = vi.fn(
    async (
      _isolation: string,
      work: (manager: EntityManager) => Promise<unknown>,
    ) => work({ query } as unknown as EntityManager),
  );
  const config = {
    get: vi.fn((name: keyof EnvironmentVariables) =>
      name === 'ARCHIVE_BATCH_SIZE' ? 25 : 60_000,
    ),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const service = new ArchiveClaimService(
    { transaction } as unknown as DataSource,
    config,
  );

  beforeEach(() => vi.clearAllMocks());

  it('claims a bounded ordered batch and marks expired ownership as reclaimed', async () => {
    const firstChatId = '11111111-1111-4111-8111-111111111111';
    const secondChatId = '22222222-2222-4222-8222-222222222222';
    query
      .mockResolvedValueOnce([
        { chat_id: firstChatId, reclaimed: false },
        { chat_id: secondChatId, reclaimed: true },
      ])
      .mockResolvedValueOnce([
        { claimed_at: new Date('2026-11-06T10:00:00.000Z') },
      ])
      .mockImplementationOnce(async (_sql: string, values: unknown[]) => [
        { chat_id: values[0] },
      ])
      .mockImplementationOnce(async (_sql: string, values: unknown[]) => [
        { chat_id: values[0] },
      ]);

    const claims = await service.claimDueBatch();

    expect(claims).toEqual([
      {
        chatId: firstChatId,
        claimToken: expect.any(String),
        reclaimed: false,
      },
      {
        chatId: secondChatId,
        claimToken: expect.any(String),
        reclaimed: true,
      },
    ]);
    expect(transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(query.mock.calls[0]![0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[0]![0]).toContain(
      'ORDER BY chat.closes_at ASC, chat.id ASC',
    );
    expect(query.mock.calls[0]![1]).toEqual([25]);
    expect(query.mock.calls[2]![1]).toEqual([
      firstChatId,
      claims[0]!.claimToken,
      new Date('2026-11-06T10:00:00.000Z'),
      60_000,
    ]);
  });

  it('commits an empty cycle without allocating tokens', async () => {
    query.mockResolvedValueOnce([]);

    await expect(service.claimDueBatch()).resolves.toEqual([]);
    expect(query).toHaveBeenCalledOnce();
  });
});
