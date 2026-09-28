import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CreditAccount } from '../database/entities/credit-account.entity.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';

describe('CreditAccountQueryService', () => {
  const findOneBy = vi.fn();
  const service = new CreditAccountQueryService({
    findOneBy,
  } as unknown as Repository<CreditAccount>);

  beforeEach(() => {
    findOneBy.mockReset();
  });

  it('returns a detached balance snapshot from an unlocked primary-key lookup', async () => {
    const account = {
      userId: 7,
      creditBalance: 100,
      reservedBalance: 20,
      version: 3,
    } as CreditAccount;
    findOneBy.mockResolvedValue(account);

    await expect(service.getBalance(7)).resolves.toEqual({
      userId: 7,
      creditBalance: 100,
      reservedBalance: 20,
    });
    expect(findOneBy).toHaveBeenCalledExactlyOnceWith({ userId: 7 });
    expect(account).toEqual({
      userId: 7,
      creditBalance: 100,
      reservedBalance: 20,
      version: 3,
    });
  });

  it('centralizes the missing-account response', async () => {
    findOneBy.mockResolvedValue(null);

    await expect(service.getBalance(7)).rejects.toMatchObject({
      status: 404,
      response: {
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      },
    } satisfies Partial<NotFoundException>);
  });
});
