import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CreditAccount } from '../database/entities/credit-account.entity.js';
import { CreditTransaction } from '../database/entities/credit-transaction.entity.js';
import { CreditTransactionQueryService } from './credit-transaction-query.service.js';

describe('CreditTransactionQueryService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const existsBy = vi.fn();
  const findAndCount = vi.fn();
  const service = new CreditTransactionQueryService(
    { existsBy } as unknown as Repository<CreditAccount>,
    { findAndCount } as unknown as Repository<CreditTransaction>,
  );

  beforeEach(() => {
    existsBy.mockReset();
    findAndCount.mockReset();
  });

  it('returns detached ledger items involving the user in deterministic order', async () => {
    existsBy.mockResolvedValue(true);
    findAndCount.mockResolvedValue([
      [
        {
          id: '55555555-5555-4555-8555-555555555555',
          type: 'TRANSFER',
          amount: 25,
          originBalanceType: 'RESERVED_BALANCE',
          destinationBalanceType: 'CREDIT_BALANCE',
          originUserId: userId,
          destinationUserId: otherUserId,
          errandId: '33333333-3333-4333-8333-333333333333',
          createdAt: new Date('2026-10-17T08:00:00.000Z'),
        } as CreditTransaction,
      ],
      3,
    ]);

    await expect(service.listHistory(userId, 1, 2)).resolves.toEqual({
      items: [
        {
          transactionId: '55555555-5555-4555-8555-555555555555',
          type: 'TRANSFER',
          datetime: '2026-10-17T08:00:00.000Z',
          amount: 25,
          errandId: '33333333-3333-4333-8333-333333333333',
          origin: { userId, balanceType: 'RESERVED_BALANCE' },
          destination: {
            userId: otherUserId,
            balanceType: 'CREDIT_BALANCE',
          },
        },
      ],
      total: 3,
      offset: 1,
      limit: 2,
    });
    expect(existsBy).toHaveBeenCalledExactlyOnceWith({ userId });
    expect(findAndCount).toHaveBeenCalledExactlyOnceWith({
      where: [{ originUserId: userId }, { destinationUserId: userId }],
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 1,
      take: 2,
    });
  });

  it('returns an empty page for an existing account without transactions', async () => {
    existsBy.mockResolvedValue(true);
    findAndCount.mockResolvedValue([[], 0]);

    await expect(service.listHistory(userId, 25, 25)).resolves.toEqual({
      items: [],
      total: 0,
      offset: 25,
      limit: 25,
    });
  });

  it('centralizes the missing-account response without querying the ledger', async () => {
    existsBy.mockResolvedValue(false);

    await expect(service.listHistory(userId, 0, 25)).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      },
    } satisfies Partial<NotFoundException>);
    expect(findAndCount).not.toHaveBeenCalled();
  });
});
