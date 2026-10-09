import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CreditAccount } from '../database/entities/credit-account.entity.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';

describe('CreditAccountQueryService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const findOneBy = vi.fn();
  const service = new CreditAccountQueryService({
    findOneBy,
  } as unknown as Repository<CreditAccount>);

  beforeEach(() => {
    findOneBy.mockReset();
  });

  it('returns a detached balance snapshot from an unlocked primary-key lookup', async () => {
    const account = {
      userId,
      creditBalance: 100,
      reservedBalance: 20,
      version: 3,
    } as CreditAccount;
    findOneBy.mockResolvedValue(account);

    await expect(service.getBalance(userId)).resolves.toEqual({
      userId,
      creditBalance: 100,
      reservedBalance: 20,
    });
    expect(findOneBy).toHaveBeenCalledExactlyOnceWith({ userId });
    expect(account).toEqual({
      userId,
      creditBalance: 100,
      reservedBalance: 20,
      version: 3,
    });
  });

  it('centralizes the missing-account response', async () => {
    findOneBy.mockResolvedValue(null);

    await expect(service.getBalance(userId)).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      },
    } satisfies Partial<NotFoundException>);
  });
});
