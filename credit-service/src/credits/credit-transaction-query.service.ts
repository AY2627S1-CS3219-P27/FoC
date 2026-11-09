import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Paginated } from '@foc/contracts';
import { Repository } from 'typeorm';
import { CreditAccount } from '../database/entities/credit-account.entity.js';
import { CreditTransaction } from '../database/entities/credit-transaction.entity.js';
import type { CreditTransactionHistoryItemDto } from './credits.dto.js';

export type CreditTransactionHistoryPage = Omit<
  Paginated<CreditTransactionHistoryItemDto>,
  'hasMore'
>;

@Injectable()
export class CreditTransactionQueryService {
  constructor(
    @InjectRepository(CreditAccount)
    private readonly accounts: Repository<CreditAccount>,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
  ) {}

  async listHistory(
    userId: string,
    offset: number,
    limit: number,
  ): Promise<CreditTransactionHistoryPage> {
    if (!(await this.accounts.existsBy({ userId }))) {
      throw new NotFoundException({
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      });
    }

    const [transactions, total] = await this.transactions.findAndCount({
      where: [{ originUserId: userId }, { destinationUserId: userId }],
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit,
    });

    return {
      items: transactions.map((transaction) => ({
        transactionId: transaction.id,
        type: transaction.type,
        datetime: transaction.createdAt.toISOString(),
        amount: transaction.amount,
        errandId: transaction.errandId,
        origin: {
          userId: transaction.originUserId,
          balanceType: transaction.originBalanceType,
        },
        destination: {
          userId: transaction.destinationUserId,
          balanceType: transaction.destinationBalanceType,
        },
      })),
      total,
      offset,
      limit,
    };
  }
}
