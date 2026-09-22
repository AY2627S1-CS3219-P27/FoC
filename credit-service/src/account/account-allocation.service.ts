import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.js';
import { CreditAccount, CreditAllocation } from '../database/entities/index.js';

export interface AccountAllocationOutcome {
  userId: string;
  allocationId: string;
  creditAmountAllocated: number;
  allocatedAt: Date;
  created: boolean;
}

export class AccountAllocationInvariantError extends Error {
  constructor(userId: string) {
    super(`Credit account ${userId} exists without an allocation`);
    this.name = 'AccountAllocationInvariantError';
  }
}

export class AccountAllocationTransactionRequiredError extends Error {
  constructor() {
    super('Account allocation requires an active caller-owned transaction');
    this.name = 'AccountAllocationTransactionRequiredError';
  }
}

function assertValidAllocation(
  amount: number | undefined,
): asserts amount is number {
  if (!Number.isSafeInteger(amount) || (amount ?? 0) <= 0) {
    throw new RangeError(
      'INITIAL_CREDIT_BALANCE must be a positive JavaScript-safe integer',
    );
  }
}

function outcome(
  allocation: CreditAllocation,
  created: boolean,
): AccountAllocationOutcome {
  return {
    userId: allocation.userId,
    allocationId: allocation.id,
    creditAmountAllocated: allocation.amount,
    allocatedAt: allocation.createdAt,
    created,
  };
}

/**
 * Initializes a user's spendable credit exactly once.
 */
@Injectable()
export class AccountAllocationService {
  private readonly initialCreditBalance: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const initialCreditBalance = config.get('INITIAL_CREDIT_BALANCE', {
      infer: true,
    });
    assertValidAllocation(initialCreditBalance);
    this.initialCreditBalance = initialCreditBalance;
  }

  async allocate(
    manager: EntityManager,
    userId: string,
  ): Promise<AccountAllocationOutcome> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new AccountAllocationTransactionRequiredError();
    }

    // Check existing records to see if user was allocated credits before
    // We don't want to assign the initial credit allocation more than once per user
    const allocations = manager.getRepository(CreditAllocation);
    const established = await allocations.findOneBy({ userId });
    if (established) {
      return outcome(established, false);
    }

    // The account primary key is the concurrency gate. Under SERIALIZABLE
    // isolation, a racing transaction is retried by SerializableTransactionRunner
    const insertion = await manager
      .createQueryBuilder()
      .insert()
      .into(CreditAccount)
      .values({
        userId,
        creditBalance: this.initialCreditBalance,
        reservedBalance: 0,
      })
      .orIgnore()  // ON CONFLICT DO NOTHING
      .returning(['user_id'])
      .execute();

    // If the account was not created, check if the allocation exists
    // Non-empty raw means le account was created successfully :D
    const accountCreated = Array.isArray(insertion.raw) && insertion.raw.length > 0;
    if (!accountCreated) {
      const allocation = await allocations.findOneBy({ userId });
      if (!allocation) {
        // An account and its initial allocation must always be committed together
        throw new AccountAllocationInvariantError(userId);
      }

      return outcome(allocation, false);
    }

    // If all good create the allocation record
    const allocation = await allocations.save(
      allocations.create({
        id: randomUUID(),
        userId,
        amount: this.initialCreditBalance,
      }),
    );

    return outcome(allocation, true);
  }
}
