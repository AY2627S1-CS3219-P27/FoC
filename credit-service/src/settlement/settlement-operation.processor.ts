import { randomUUID } from 'node:crypto';
import {
  CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY,
  CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY,
  type CreditSettlementRejectedEvent,
  type CreditSettlementRejectionReason,
  type CreditSettlementSucceededEvent,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CreditAccount,
  CreditOperation,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

type SupportedSettlementRejectionReason = Exclude<
  CreditSettlementRejectionReason,
  'DESTINATION_ARCHIVED'
>;

export type SettlementProcessingOutcome =
  | {
      status: 'succeeded';
      operationId: string;
      requesterTransactionId: string | null;
      courierTransactionId: string | null;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      operationId: string;
      reason: SupportedSettlementRejectionReason;
      outboxEventId: string;
    }
  | { status: 'claim-lost'; operationId: string };

type SettlementOperation = CreditOperation & {
  requesterUserId: string;
  courierUserId: string;
  amount: number;
  settlementAttempt: number;
  requesterAmount: number;
  courierAmount: number;
};

type SettlementTransactions = {
  requester: CreditTransaction | null;
  courier: CreditTransaction | null;
};

export class CreditSettlementExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditSettlementExecutionError';
  }
}

function assertSettlementContext(
  operation: CreditOperation,
): asserts operation is SettlementOperation {
  if (
    !operation.requesterUserId ||
    !operation.courierUserId ||
    operation.requesterUserId === operation.courierUserId ||
    operation.amount === null ||
    !Number.isSafeInteger(operation.amount) ||
    operation.amount <= 0 ||
    operation.settlementAttempt === null ||
    !Number.isSafeInteger(operation.settlementAttempt) ||
    operation.settlementAttempt <= 0 ||
    operation.requesterAmount === null ||
    !Number.isSafeInteger(operation.requesterAmount) ||
    operation.requesterAmount < 0 ||
    operation.courierAmount === null ||
    !Number.isSafeInteger(operation.courierAmount) ||
    operation.courierAmount < 0 ||
    operation.requesterAmount + operation.courierAmount !== operation.amount
  ) {
    throw new CreditSettlementExecutionError(
      'Settlement operation has invalid participant, attempt, or share context',
    );
  }
}

function assertSafeAccountState(account: CreditAccount): void {
  if (
    !Number.isSafeInteger(account.creditBalance) ||
    account.creditBalance < 0 ||
    !Number.isSafeInteger(account.reservedBalance) ||
    account.reservedBalance < 0
  ) {
    throw new CreditSettlementExecutionError(
      'Settlement encountered an unsupported account balance',
    );
  }
}

/** Executes a leased SETTLEMENT operation within one serializable transaction. */
@Injectable()
export class SettlementOperationProcessor {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async processClaimed(
    operationId: string,
    workerId: string,
  ): Promise<SettlementProcessingOutcome> {
    return this.transactions.run(async (manager) => {
      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.findOne({
        where: { id: operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.operationType !== 'SETTLEMENT' ||
        operation.status !== 'PENDING' ||
        operation.claimedBy !== workerId ||
        !operation.claimedUntil ||
        operation.claimedUntil.getTime() <= Date.now()
      ) {
        return { status: 'claim-lost', operationId };
      }
      assertSettlementContext(operation);

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [operation.errandId],
      );

      // Do not row-lock the transfer operation. Transfer takes its own row
      // lock before the errand lock, so taking both in the reverse order could
      // deadlock. The errand lock makes its terminal state stable here.
      const transferOperation = await operations.findOneBy({
        errandId: operation.errandId,
        operationType: 'TRANSFER',
      });
      if (transferOperation?.status === 'PENDING') {
        throw new CreditSettlementExecutionError(
          'Settlement is waiting for the established transfer operation',
        );
      }
      if (transferOperation) {
        if (
          !transferOperation.requesterUserId ||
          !transferOperation.courierUserId
        ) {
          throw new CreditSettlementExecutionError(
            'Terminal transfer operation has incomplete participant context',
          );
        }
        if (
          transferOperation.requesterUserId !== operation.requesterUserId ||
          transferOperation.courierUserId !== operation.courierUserId
        ) {
          return this.completeRejection(
            manager,
            operation,
            'RESERVATION_USER_MISMATCH',
          );
        }
      }

      const reservations = manager.getRepository(CreditReservation);
      const reservation = await reservations.findOne({
        where: { errandId: operation.errandId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reservation) {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_NOT_FOUND',
        );
      }
      if (reservation.status === 'RELEASED') {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_RELEASED',
        );
      }
      if (reservation.status === 'CONSUMED') {
        return this.completeRejection(
          manager,
          operation,
          'ALREADY_TRANSFERRED',
        );
      }
      if (reservation.requesterUserId !== operation.requesterUserId) {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_USER_MISMATCH',
        );
      }
      if (reservation.reservedAmount !== operation.amount) {
        return this.completeRejection(manager, operation, 'AMOUNT_MISMATCH');
      }

      const accounts = await this.lockParticipantAccounts(
        manager,
        operation.requesterUserId,
        operation.courierUserId,
      );
      const requester = accounts.get(operation.requesterUserId);
      const courier = accounts.get(operation.courierUserId);
      if (!requester || !courier) {
        throw new CreditSettlementExecutionError(
          'Settlement participant has no credit account',
        );
      }
      assertSafeAccountState(requester);
      assertSafeAccountState(courier);
      if (requester.reservedBalance < reservation.reservedAmount) {
        throw new CreditSettlementExecutionError(
          'Active reservation exceeds requester reserved credit',
        );
      }

      requester.reservedBalance -= reservation.reservedAmount;
      requester.creditBalance += operation.requesterAmount;
      courier.creditBalance += operation.courierAmount;
      assertSafeAccountState(requester);
      assertSafeAccountState(courier);
      await manager.getRepository(CreditAccount).save([requester, courier]);

      const settlementTransactions = await this.recordTransactions(
        manager,
        operation,
      );
      const latestTransaction =
        settlementTransactions.courier ?? settlementTransactions.requester;
      if (!latestTransaction) {
        throw new CreditSettlementExecutionError(
          'Settlement did not produce a required ledger transaction',
        );
      }

      reservation.status = 'CONSUMED';
      reservation.latestTransactionId = latestTransaction.id;
      await reservations.save(reservation);

      return this.completeSuccess(
        manager,
        operation,
        settlementTransactions,
        latestTransaction.createdAt,
      );
    });
  }

  private async lockParticipantAccounts(
    manager: EntityManager,
    requesterUserId: string,
    courierUserId: string,
  ): Promise<Map<string, CreditAccount>> {
    const userIds = [requesterUserId, courierUserId].sort();
    const accounts = await manager
      .getRepository(CreditAccount)
      .createQueryBuilder('account')
      .setLock('pessimistic_write')
      .where('account.user_id IN (:...userIds)', { userIds })
      .orderBy('account.user_id', 'ASC')
      .getMany();
    return new Map(accounts.map((account) => [account.userId, account]));
  }

  private async recordTransactions(
    manager: EntityManager,
    operation: SettlementOperation,
  ): Promise<SettlementTransactions> {
    const transactions = manager.getRepository(CreditTransaction);
    const requester =
      operation.requesterAmount > 0
        ? await transactions.save(
            transactions.create({
              id: randomUUID(),
              type: 'RELEASE',
              amount: operation.requesterAmount,
              originBalanceType: 'RESERVED_BALANCE',
              destinationBalanceType: 'CREDIT_BALANCE',
              originUserId: operation.requesterUserId,
              destinationUserId: operation.requesterUserId,
              errandId: operation.errandId,
            }),
          )
        : null;
    const courier =
      operation.courierAmount > 0
        ? await transactions.save(
            transactions.create({
              id: randomUUID(),
              type: 'TRANSFER',
              amount: operation.courierAmount,
              originBalanceType: 'RESERVED_BALANCE',
              destinationBalanceType: 'CREDIT_BALANCE',
              originUserId: operation.requesterUserId,
              destinationUserId: operation.courierUserId,
              errandId: operation.errandId,
            }),
          )
        : null;
    return { requester, courier };
  }

  private async completeSuccess(
    manager: EntityManager,
    operation: SettlementOperation,
    settlementTransactions: SettlementTransactions,
    timestamp: Date,
  ): Promise<SettlementProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditSettlementSucceededEvent = {
      eventId,
      eventType: 'CreditSettlementSucceeded',
      timestamp: timestamp.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        courierUserId: operation.courierUserId,
        courierAmount: operation.courierAmount,
        requesterAmount: operation.requesterAmount,
        courierCreditTransactionId: settlementTransactions.courier?.id ?? null,
        requesterCreditTransactionId:
          settlementTransactions.requester?.id ?? null,
      },
    };
    await this.saveOutbox(
      manager,
      event,
      CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY,
    );
    await this.completeOperation(
      manager,
      operation,
      null,
      settlementTransactions.requester?.id ?? null,
      settlementTransactions.courier?.id ?? null,
      eventId,
    );
    return {
      status: 'succeeded',
      operationId: operation.id,
      requesterTransactionId: settlementTransactions.requester?.id ?? null,
      courierTransactionId: settlementTransactions.courier?.id ?? null,
      outboxEventId: eventId,
    };
  }

  private async completeRejection(
    manager: EntityManager,
    operation: SettlementOperation,
    reason: SupportedSettlementRejectionReason,
  ): Promise<SettlementProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditSettlementRejectedEvent = {
      eventId,
      eventType: 'CreditSettlementRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        courierUserId: operation.courierUserId,
        rejectionReason: reason,
      },
    };
    await this.saveOutbox(
      manager,
      event,
      CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY,
    );
    await this.completeOperation(
      manager,
      operation,
      reason,
      null,
      null,
      eventId,
    );
    return {
      status: 'rejected',
      operationId: operation.id,
      reason,
      outboxEventId: eventId,
    };
  }

  private async completeOperation(
    manager: EntityManager,
    operation: SettlementOperation,
    rejectionReason: SupportedSettlementRejectionReason | null,
    requesterTransactionId: string | null,
    courierTransactionId: string | null,
    outboxEventId: string,
  ): Promise<void> {
    operation.status = rejectionReason ? 'REJECTED' : 'SUCCEEDED';
    operation.rejectionReason = rejectionReason;
    operation.completionTransactionId = null;
    operation.requesterTransactionId = requesterTransactionId;
    operation.courierTransactionId = courierTransactionId;
    operation.outcomeOutboxEventId = outboxEventId;
    operation.claimedBy = null;
    operation.claimedUntil = null;
    operation.lastError = null;
    await manager.getRepository(CreditOperation).save(operation);
    await manager.getRepository(InboxEvent).update(
      { outcomeOperationId: operation.id },
      {
        outcomeTransactionId: null,
        outcomeOutboxEventId: outboxEventId,
      },
    );
  }

  private async saveOutbox(
    manager: EntityManager,
    event: CreditSettlementSucceededEvent | CreditSettlementRejectedEvent,
    routingKey: string,
  ): Promise<void> {
    const outbox = manager.getRepository(OutboxEvent);
    await outbox.save(
      outbox.create({
        eventId: event.eventId,
        eventType: event.eventType,
        routingKey,
        envelope: { ...event },
        publishedAt: null,
        attemptCount: 0,
        lastError: null,
        claimedBy: null,
        claimedUntil: null,
      }),
    );
  }
}
