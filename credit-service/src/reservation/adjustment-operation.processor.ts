import { randomUUID } from 'node:crypto';
import {
  CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
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
import type { CreditReservationAdjustmentRejectionReason } from './reservation-adjustment.service.js';

export type AdjustmentProcessingOutcome =
  | {
      status: 'succeeded';
      operationId: string;
      transactionId: string;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      operationId: string;
      reason: CreditReservationAdjustmentRejectionReason;
      outboxEventId: string;
    }
  | { status: 'claim-lost'; operationId: string };

export class CreditReservationAdjustmentInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditReservationAdjustmentInvariantError';
  }
}

function assertSafeBalances(creditBalance: number, reservedBalance: number) {
  if (
    !Number.isSafeInteger(creditBalance) ||
    creditBalance < 0 ||
    !Number.isSafeInteger(reservedBalance) ||
    reservedBalance < 0
  ) {
    throw new CreditReservationAdjustmentInvariantError(
      'Reservation adjustment would produce an unsupported account balance',
    );
  }
}

/** Executes one leased ADJUST operation within one serializable transaction. */
@Injectable()
export class AdjustmentOperationProcessor {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async processClaimed(
    operationId: string,
    workerId: string,
  ): Promise<AdjustmentProcessingOutcome> {
    return this.transactions.run(async (manager) => {
      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.findOne({
        where: { id: operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.operationType !== 'ADJUST' ||
        operation.status !== 'PENDING' ||
        operation.claimedBy !== workerId ||
        !operation.claimedUntil ||
        operation.claimedUntil.getTime() <= Date.now()
      ) {
        return { status: 'claim-lost', operationId };
      }
      if (operation.expectedAmount === null || !operation.commandEventId) {
        throw new CreditReservationAdjustmentInvariantError(
          'Adjustment operation has incomplete command state',
        );
      }

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [operation.errandId],
      );

      const reservations = manager.getRepository(CreditReservation);
      const discoveredReservation = await reservations.findOneBy({
        errandId: operation.errandId,
      });
      if (!discoveredReservation || discoveredReservation.status !== 'ACTIVE') {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_NOT_FOUND',
        );
      }

      const accounts = manager.getRepository(CreditAccount);
      const account = await accounts.findOne({
        where: { userId: discoveredReservation.requesterUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new CreditReservationAdjustmentInvariantError(
          'Active reservation has no requester credit account',
        );
      }
      const reservation = await reservations.findOne({
        where: { errandId: operation.errandId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reservation || reservation.status !== 'ACTIVE') {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_NOT_FOUND',
        );
      }
      if (reservation.requesterUserId !== account.userId) {
        throw new CreditReservationAdjustmentInvariantError(
          'Reservation requester changed during adjustment execution',
        );
      }
      operation.requesterUserId = reservation.requesterUserId;

      if (reservation.reservedAmount !== operation.expectedAmount) {
        return this.completeRejection(
          manager,
          operation,
          'STALE_RESERVATION_AMOUNT',
        );
      }
      if (operation.amount === operation.expectedAmount) {
        return this.completeSuccess(
          manager,
          operation,
          reservation.latestTransactionId,
        );
      }

      const difference = operation.amount - operation.expectedAmount;
      if (difference > 0 && account.creditBalance < difference) {
        return this.completeRejection(
          manager,
          operation,
          'INSUFFICIENT_CREDITS',
        );
      }

      const nextCreditBalance = account.creditBalance - difference;
      const nextReservedBalance = account.reservedBalance + difference;
      assertSafeBalances(nextCreditBalance, nextReservedBalance);
      account.creditBalance = nextCreditBalance;
      account.reservedBalance = nextReservedBalance;
      await accounts.save(account);

      const transactions = manager.getRepository(CreditTransaction);
      const transaction = await transactions.save(
        transactions.create({
          id: randomUUID(),
          type: 'RESERVATION_ADJUSTMENT',
          amount: Math.abs(difference),
          originBalanceType:
            difference > 0 ? 'CREDIT_BALANCE' : 'RESERVED_BALANCE',
          destinationBalanceType:
            difference > 0 ? 'RESERVED_BALANCE' : 'CREDIT_BALANCE',
          originUserId: reservation.requesterUserId,
          destinationUserId: reservation.requesterUserId,
          errandId: reservation.errandId,
        }),
      );

      reservation.reservedAmount = operation.amount;
      reservation.latestTransactionId = transaction.id;
      await reservations.save(reservation);
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
  ): Promise<AdjustmentProcessingOutcome> {
    const outboxEventId = randomUUID();
    await this.saveOutbox(
      manager,
      outboxEventId,
      'CreditReservationAdjustmentSuccess',
      CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
      {
        eventId: outboxEventId,
        eventType: 'CreditReservationAdjustmentSuccess',
        timestamp: occurredAt.toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: operation.errandId,
          newReservedAmount: operation.amount,
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
    reason: CreditReservationAdjustmentRejectionReason,
  ): Promise<AdjustmentProcessingOutcome> {
    const outboxEventId = randomUUID();
    await this.saveOutbox(
      manager,
      outboxEventId,
      'CreditReservationAdjustmentRejected',
      CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
      {
        eventId: outboxEventId,
        eventType: 'CreditReservationAdjustmentRejected',
        timestamp: new Date().toISOString(),
        publisher: 'credit-service',
        payload: {
          errandId: operation.errandId,
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
    operation.lastError = null;
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
