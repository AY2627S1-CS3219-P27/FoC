import { randomUUID } from 'node:crypto';
import {
  CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
  CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
  type CreditReleaseRejectedEvent,
  type CreditReleaseRejectionReason,
  type CreditReleaseSuccessEvent,
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
import { ledgerReservedAmount } from './ledger-reserved-amount.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export type ReleaseProcessingOutcome =
  | {
      status: 'succeeded';
      operationId: string;
      transactionId: string;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      operationId: string;
      reason: CreditReleaseRejectionReason;
      outboxEventId: string;
    }
  | { status: 'claim-lost'; operationId: string };

type ReleaseOperationWithContext = CreditOperation & {
  requesterUserId: string;
  amount: number;
};

type DeferredRelease = { status: 'deferred'; message: string };

export class CreditReleaseExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditReleaseExecutionError';
  }
}

function assertPositiveAmount(amount: number | null): asserts amount is number {
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
    throw new CreditReleaseExecutionError(
      'Release operation has no valid positive amount context',
    );
  }
}

function assertReleaseContext(
  operation: CreditOperation,
): asserts operation is ReleaseOperationWithContext {
  if (!operation.requesterUserId) {
    throw new CreditReleaseExecutionError(
      'Release operation has no requester context',
    );
  }
  assertPositiveAmount(operation.amount);
}

function assertSafeAccountState(account: CreditAccount): void {
  if (
    !Number.isSafeInteger(account.creditBalance) ||
    account.creditBalance < 0 ||
    !Number.isSafeInteger(account.reservedBalance) ||
    account.reservedBalance < 0
  ) {
    throw new CreditReleaseExecutionError(
      'Release encountered an unsupported account balance',
    );
  }
}

function hasSafeAccountState(account: CreditAccount): boolean {
  try {
    assertSafeAccountState(account);
    return true;
  } catch {
    return false;
  }
}

/** Executes a leased RELEASE operation within one serializable transaction. */
@Injectable()
export class ReleaseOperationProcessor {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async processClaimed(
    operationId: string,
    workerId: string,
  ): Promise<ReleaseProcessingOutcome> {
    const result = await this.transactions.run<
      ReleaseProcessingOutcome | DeferredRelease
    >(async (manager) => {
      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.findOne({
        where: { id: operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.operationType !== 'RELEASE' ||
        operation.status !== 'PENDING' ||
        operation.claimedBy !== workerId ||
        !operation.claimedUntil ||
        operation.claimedUntil.getTime() <= Date.now()
      ) {
        return { status: 'claim-lost', operationId };
      }

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [operation.errandId],
      );

      const reservation = await manager
        .getRepository(CreditReservation)
        .findOne({
          where: { errandId: operation.errandId },
          lock: { mode: 'pessimistic_write' },
        });
      // Do not lock this row: a reserve worker locks it before waiting for the
      // errand advisory lock, so a second row lock here could form a cycle.
      const reserveOperation = await operations.findOneBy({
        errandId: operation.errandId,
        operationType: 'RESERVE',
      });

      if (!reservation) {
        if (!reserveOperation) {
          return this.defer(
            'Release is waiting for an authoritative reserve outcome',
          );
        }
        const enriched = this.enrichFromReserve(operation, reserveOperation);
        if (reserveOperation.status === 'PENDING') {
          if (enriched) {
            await operations.save(operation);
          }
          return this.defer(
            'Release is waiting for an authoritative reserve outcome',
          );
        }
        if (reserveOperation.status === 'SUCCEEDED') {
          if (enriched) {
            await operations.save(operation);
          }
          return this.defer('Successful reserve operation has no reservation');
        }
        assertReleaseContext(operation);
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_NOT_FOUND',
        );
      }

      const contextEnriched = this.enrichFromReservation(
        operation,
        reservation,
      );
      await this.assertReserveCompatibility(manager, reservation, reserveOperation);
      assertReleaseContext(operation);

      if (reservation.status === 'CONSUMED') {
        return this.completeRejection(
          manager,
          operation,
          'ALREADY_TRANSFERRED',
        );
      }
      if (reservation.status === 'RELEASED') {
        if (contextEnriched) {
          await operations.save(operation);
        }
        return this.defer(
          'Pending release found a reservation already released',
        );
      }

      const accounts = manager.getRepository(CreditAccount);
      const requester = await accounts.findOne({
        where: { userId: operation.requesterUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!requester) {
        if (contextEnriched) {
          await operations.save(operation);
        }
        return this.defer('Release requester has no credit account');
      }
      if (!hasSafeAccountState(requester)) {
        if (contextEnriched) {
          await operations.save(operation);
        }
        return this.defer('Release encountered an unsupported account balance');
      }
      if (requester.reservedBalance < operation.amount) {
        if (contextEnriched) {
          await operations.save(operation);
        }
        return this.defer(
          'Active reservation exceeds requester reserved credit',
        );
      }

      const nextReservedBalance = requester.reservedBalance - operation.amount;
      const nextCreditBalance = requester.creditBalance + operation.amount;
      if (
        !Number.isSafeInteger(nextReservedBalance) ||
        nextReservedBalance < 0 ||
        !Number.isSafeInteger(nextCreditBalance) ||
        nextCreditBalance < 0
      ) {
        if (contextEnriched) {
          await operations.save(operation);
        }
        return this.defer(
          'Release would produce an unsupported account balance',
        );
      }
      requester.reservedBalance = nextReservedBalance;
      requester.creditBalance = nextCreditBalance;
      await accounts.save(requester);

      const transactions = manager.getRepository(CreditTransaction);
      const transaction = await transactions.save(
        transactions.create({
          id: randomUUID(),
          type: 'RELEASE',
          amount: operation.amount,
          originBalanceType: 'RESERVED_BALANCE',
          destinationBalanceType: 'CREDIT_BALANCE',
          originUserId: operation.requesterUserId,
          destinationUserId: operation.requesterUserId,
          errandId: operation.errandId,
        }),
      );

      const transition = await manager
        .getRepository(CreditReservation)
        .createQueryBuilder()
        .update(CreditReservation)
        .set({
          status: 'RELEASED',
          latestTransactionId: transaction.id,
        })
        .where('id = :id', { id: reservation.id })
        .andWhere('status = :status', { status: 'ACTIVE' })
        .execute();
      if (transition.affected !== 1) {
        throw new CreditReleaseExecutionError(
          'Active reservation transition was not applied',
        );
      }

      return this.completeSuccess(manager, operation, transaction);
    });
    if (result.status === 'deferred') {
      throw new CreditReleaseExecutionError(result.message);
    }
    return result;
  }

  private enrichFromReserve(
    operation: CreditOperation,
    reserveOperation: CreditOperation,
  ): boolean {
    if (!reserveOperation.requesterUserId) {
      throw new CreditReleaseExecutionError(
        'Terminal reserve operation has no requester context',
      );
    }
    assertPositiveAmount(reserveOperation.amount);
    return this.mergeContext(
      operation,
      reserveOperation.requesterUserId,
      reserveOperation.amount,
    );
  }

  private enrichFromReservation(
    operation: CreditOperation,
    reservation: CreditReservation,
  ): boolean {
    assertPositiveAmount(reservation.reservedAmount);
    return this.mergeContext(
      operation,
      reservation.requesterUserId,
      reservation.reservedAmount,
    );
  }

  private mergeContext(
    operation: CreditOperation,
    requesterUserId: string,
    amount: number,
  ): boolean {
    if (
      operation.requesterUserId &&
      operation.requesterUserId !== requesterUserId
    ) {
      throw new CreditReleaseExecutionError(
        'Release operation disagrees with authoritative requester context',
      );
    }
    if (operation.amount !== null && operation.amount !== amount) {
      throw new CreditReleaseExecutionError(
        'Release operation disagrees with authoritative amount context',
      );
    }
    const changed =
      operation.requesterUserId === null || operation.amount === null;
    operation.requesterUserId ??= requesterUserId;
    operation.amount ??= amount;
    return changed;
  }

  private defer(message: string): DeferredRelease {
    return { status: 'deferred', message };
  }

  private async assertReserveCompatibility(
    manager: EntityManager,
    reservation: CreditReservation,
    reserveOperation: CreditOperation | null,
  ): Promise<void> {
    if (reserveOperation && reserveOperation.status !== 'SUCCEEDED') {
      throw new CreditReleaseExecutionError(
        'Reservation exists without a successful reserve operation',
      );
    }
    if (
      reserveOperation?.requesterUserId &&
      reserveOperation.requesterUserId !== reservation.requesterUserId
    ) {
      throw new CreditReleaseExecutionError(
        'Reservation and reserve operation disagree on requester',
      );
    }
    const expectedAmount =
      reserveOperation?.amount !== null && reserveOperation?.amount !== undefined
        ? await ledgerReservedAmount(manager, reservation.errandId, reserveOperation.amount)
        : null;
    if (expectedAmount !== null && expectedAmount !== reservation.reservedAmount) {
      throw new CreditReleaseExecutionError(
        'Reservation disagrees with the amount its reserve and adjustment operations recorded',
      );
    }
  }

  private async completeSuccess(
    manager: EntityManager,
    operation: ReleaseOperationWithContext,
    transaction: CreditTransaction,
  ): Promise<ReleaseProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditReleaseSuccessEvent = {
      eventId,
      eventType: 'CreditReleaseSuccess',
      timestamp: transaction.createdAt.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        releasedAmount: transaction.amount,
        creditTransactionId: transaction.id,
      },
    };
    await this.saveOutbox(
      manager,
      event,
      CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
    );
    await this.completeOperation(
      manager,
      operation,
      null,
      transaction.id,
      eventId,
    );
    return {
      status: 'succeeded',
      operationId: operation.id,
      transactionId: transaction.id,
      outboxEventId: eventId,
    };
  }

  private async completeRejection(
    manager: EntityManager,
    operation: ReleaseOperationWithContext,
    reason: CreditReleaseRejectionReason,
  ): Promise<ReleaseProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditReleaseRejectedEvent = {
      eventId,
      eventType: 'CreditReleaseRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        rejectionReason: reason,
      },
    };
    await this.saveOutbox(
      manager,
      event,
      CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
    );
    await this.completeOperation(manager, operation, reason, null, eventId);
    return {
      status: 'rejected',
      operationId: operation.id,
      reason,
      outboxEventId: eventId,
    };
  }

  private async completeOperation(
    manager: EntityManager,
    operation: ReleaseOperationWithContext,
    rejectionReason: CreditReleaseRejectionReason | null,
    transactionId: string | null,
    outboxEventId: string,
  ): Promise<void> {
    operation.status = rejectionReason ? 'REJECTED' : 'SUCCEEDED';
    operation.rejectionReason = rejectionReason;
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
  }

  private async saveOutbox(
    manager: EntityManager,
    event: CreditReleaseSuccessEvent | CreditReleaseRejectedEvent,
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
