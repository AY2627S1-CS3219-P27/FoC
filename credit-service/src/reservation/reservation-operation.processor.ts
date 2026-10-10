import { randomUUID } from 'node:crypto';
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
import {
  CREDIT_RESERVATION_REJECTED_ROUTING_KEY,
  CREDIT_RESERVATION_SUCCESS_ROUTING_KEY,
  CreditReservationInvariantError,
  type CreditReservationRejectionReason,
} from './reservation.service.js';

export type ReservationProcessingOutcome =
  | {
      status: 'succeeded';
      operationId: string;
      transactionId: string;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      operationId: string;
      reason: CreditReservationRejectionReason;
      outboxEventId: string;
    }
  | { status: 'claim-lost'; operationId: string };

function assertSafeBalances(creditBalance: number, reservedBalance: number) {
  if (
    !Number.isSafeInteger(creditBalance) ||
    creditBalance < 0 ||
    !Number.isSafeInteger(reservedBalance) ||
    reservedBalance < 0
  ) {
    throw new CreditReservationInvariantError(
      'Reservation movement would produce an unsupported account balance',
    );
  }
}

/** Executes a leased RESERVE operation within one serializable transaction. */
@Injectable()
export class ReservationOperationProcessor {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async processClaimed(
    operationId: string,
    workerId: string,
  ): Promise<ReservationProcessingOutcome> {
    return this.transactions.run(async (manager) => {
      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.findOne({
        where: { id: operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.operationType !== 'RESERVE' ||
        operation.status !== 'PENDING' ||
        operation.claimedBy !== workerId ||
        !operation.claimedUntil ||
        operation.claimedUntil.getTime() <= Date.now()
      ) {
        return { status: 'claim-lost', operationId };
      }
      if (!operation.requesterUserId) {
        throw new CreditReservationInvariantError(
          'Reservation operation has no requester',
        );
      }
      const requesterUserId = operation.requesterUserId;

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [operation.errandId],
      );

      const accounts = manager.getRepository(CreditAccount);
      const account = await accounts.findOne({
        where: { userId: requesterUserId },
        lock: { mode: 'pessimistic_write' },
      });
      const reservations = manager.getRepository(CreditReservation);
      const reservation = await reservations.findOne({
        where: { errandId: operation.errandId },
        lock: { mode: 'pessimistic_write' },
      });

      if (reservation) {
        if (
          reservation.status === 'ACTIVE' &&
          reservation.requesterUserId === requesterUserId &&
          reservation.reservedAmount === operation.amount
        ) {
          return this.completeSuccess(
            manager,
            operation,
            reservation.latestTransactionId,
          );
        }
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_CONFLICT',
        );
      }
      if (!account) {
        return this.completeRejection(manager, operation, 'MISSING_BALANCE');
      }
      if (account.creditBalance < operation.amount) {
        return this.completeRejection(
          manager,
          operation,
          'INSUFFICIENT_CREDITS',
        );
      }

      const nextCreditBalance = account.creditBalance - operation.amount;
      const nextReservedBalance = account.reservedBalance + operation.amount;
      assertSafeBalances(nextCreditBalance, nextReservedBalance);
      account.creditBalance = nextCreditBalance;
      account.reservedBalance = nextReservedBalance;
      await accounts.save(account);

      const transactions = manager.getRepository(CreditTransaction);
      const transaction = await transactions.save(
        transactions.create({
          id: randomUUID(),
          type: 'RESERVATION',
          amount: operation.amount,
          originBalanceType: 'CREDIT_BALANCE',
          destinationBalanceType: 'RESERVED_BALANCE',
          originUserId: requesterUserId,
          destinationUserId: requesterUserId,
          errandId: operation.errandId,
        }),
      );
      await reservations.save(
        reservations.create({
          id: randomUUID(),
          errandId: operation.errandId,
          requesterUserId,
          reservedAmount: operation.amount,
          status: 'ACTIVE',
          latestTransactionId: transaction.id,
        }),
      );

      return this.completeSuccess(
        manager,
        operation,
        transaction.id,
        transaction.createdAt,
      );
    });
  }

  private async completeSuccess(
    manager: EntityManager,
    operation: CreditOperation,
    transactionId: string,
    occurredAt = new Date(),
  ): Promise<ReservationProcessingOutcome> {
    const outboxEventId = randomUUID();
    await this.saveOutbox(
      manager,
      outboxEventId,
      'CreditReservationSuccess',
      CREDIT_RESERVATION_SUCCESS_ROUTING_KEY,
      {
        eventId: outboxEventId,
        eventType: 'CreditReservationSuccess',
        timestamp: occurredAt.toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: operation.errandId,
          requesterUserId: operation.requesterUserId!,
          reservedAmount: operation.amount,
          creditTransactionId: transactionId,
        },
      },
    );

    operation.status = 'SUCCEEDED';
    operation.rejectionReason = null;
    operation.completionTransactionId = transactionId;
    operation.outcomeOutboxEventId = outboxEventId;
    operation.claimedBy = null;
    operation.claimedUntil = null;
    operation.lastError = null;
    await manager.getRepository(CreditOperation).save(operation);
    await manager.getRepository(InboxEvent).update(
      { outcomeOperationId: operation.id },
      {
        outcomeTransactionId: transactionId,
        outcomeOutboxEventId: outboxEventId,
      },
    );

    return {
      status: 'succeeded',
      operationId: operation.id,
      transactionId,
      outboxEventId,
    };
  }

  private async completeRejection(
    manager: EntityManager,
    operation: CreditOperation,
    reason: CreditReservationRejectionReason,
  ): Promise<ReservationProcessingOutcome> {
    const outboxEventId = randomUUID();
    await this.saveOutbox(
      manager,
      outboxEventId,
      'CreditReservationRejected',
      CREDIT_RESERVATION_REJECTED_ROUTING_KEY,
      {
        eventId: outboxEventId,
        eventType: 'CreditReservationRejected',
        timestamp: new Date().toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: operation.errandId,
          requesterUserId: operation.requesterUserId!,
          requestedAmount: operation.amount,
          rejectionReason: reason,
        },
      },
    );

    operation.status = 'REJECTED';
    operation.rejectionReason = reason;
    operation.completionTransactionId = null;
    operation.outcomeOutboxEventId = outboxEventId;
    operation.claimedBy = null;
    operation.claimedUntil = null;
    await manager.getRepository(CreditOperation).save(operation);
    await manager
      .getRepository(InboxEvent)
      .update(
        { outcomeOperationId: operation.id },
        { outcomeTransactionId: null, outcomeOutboxEventId: outboxEventId },
      );

    return {
      status: 'rejected',
      operationId: operation.id,
      reason,
      outboxEventId,
    };
  }

  private async saveOutbox(
    manager: EntityManager,
    eventId: string,
    eventType: string,
    routingKey: string,
    envelope: Record<string, unknown>,
  ): Promise<void> {
    const outbox = manager.getRepository(OutboxEvent);
    await outbox.save(
      outbox.create({
        eventId,
        eventType,
        routingKey,
        envelope,
        publishedAt: null,
        attemptCount: 0,
        lastError: null,
        claimedBy: null,
        claimedUntil: null,
      }),
    );
  }
}
