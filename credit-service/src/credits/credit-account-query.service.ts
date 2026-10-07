import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditAccount } from '../database/entities/credit-account.entity.js';

export interface CreditBalanceSnapshot {
  userId: string;
  creditBalance: number;
  reservedBalance: number;
}

@Injectable()
export class CreditAccountQueryService {
  constructor(
    @InjectRepository(CreditAccount)
    private readonly accounts: Repository<CreditAccount>,
  ) {}

  async getBalance(userId: string): Promise<CreditBalanceSnapshot> {
    const account = await this.accounts.findOneBy({ userId });
    if (!account) {
      throw new NotFoundException({
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      });
    }

    return {
      userId: account.userId,
      creditBalance: account.creditBalance,
      reservedBalance: account.reservedBalance,
    };
  }
}
