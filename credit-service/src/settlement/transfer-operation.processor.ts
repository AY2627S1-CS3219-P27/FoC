import { randomUUID } from 'node:crypto';
import {
  CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
  CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
  type CreditTransferRejectedEvent,
  type CreditTransferRejectionReason,
  type CreditTransferSucceededEvent,
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

export type TransferProcessingOutcome =
  | {
      status: 'succeeded';
      operationId: string;
      transactionId: string;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      operationId: string;
      reason: Exclude<CreditTransferRejectionReason, 'DESTINATION_ARCHIVED'>;
      outboxEventId: string;
    }
  | { status: 'claim-lost'; operationId: string };

type SupportedTransferRejectionReason = Exclude<
  CreditTransferRejectionReason,
  'DESTINATION_ARCHIVED'
>;

type TransferOperation = CreditOperation & {
  requesterUserId: string;
  courierUserId: string;
  amount: number;
};

export class CreditTransferInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditTransferInvariantError';
  }
}

function assertTransferContext(
  operation: CreditOperation,
): asserts operation is TransferOperation {
  if (
    !operation.requesterUserId ||
    !operation.courierUserId ||
    operation.requesterUserId === operation.courierUserId ||
    operation.amount === null ||
    !Number.isSafeInteger(operation.amount) ||
    operation.amount <= 0
  ) {
    throw new CreditTransferInvariantError(
      'Transfer operation has incomplete participant or amount context',
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
    throw new CreditTransferInvariantError(
      'Transfer encountered an unsupported account balance',
    );
  }
}

/** Executes a leased TRANSFER operation within one serializable transaction. */
@Injectable()
export class TransferOperationProcessor {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async processClaimed(
    operationId: string,
    workerId: string,
  ): Promise<TransferProcessingOutcome> {
    return this.transactions.run(async (manager) => {
      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.findOne({
        where: { id: operationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.operationType !== 'TRANSFER' ||
        operation.status !== 'PENDING' ||
        operation.claimedBy !== workerId ||
        !operation.claimedUntil ||
        operation.claimedUntil.getTime() <= Date.now()
      ) {
        return { status: 'claim-lost', operationId };
      }
      assertTransferContext(operation);

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [operation.errandId],
      );

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
        throw new CreditTransferInvariantError(
          'Pending transfer found an already consumed reservation',
        );
      }
      if (reservation.requesterUserId !== operation.requesterUserId) {
        return this.completeRejection(
          manager,
          operation,
          'RESERVATION_USER_MISMATCH',
        );
      }

      const accounts = await this.lockParticipantAccounts(
        manager,
        operation.requesterUserId,
        operation.courierUserId,
      );
      const requester = accounts.get(operation.requesterUserId);
      const courier = accounts.get(operation.courierUserId);
      if (!requester || !courier) {
        throw new CreditTransferInvariantError(
          'Transfer participant has no credit account',
        );
      }
      assertSafeAccountState(requester);
      assertSafeAccountState(courier);

      const transferredAmount = reservation.reservedAmount;
      if (
        !Number.isSafeInteger(transferredAmount) ||
        transferredAmount <= 0 ||
        requester.reservedBalance < transferredAmount
      ) {
        throw new CreditTransferInvariantError(
          'Active reservation is inconsistent with requester reserved credit',
        );
      }

      requester.reservedBalance -= transferredAmount;
      courier.creditBalance += transferredAmount;
      assertSafeAccountState(requester);
      assertSafeAccountState(courier);
      await manager.getRepository(CreditAccount).save([requester, courier]);

      const transactions = manager.getRepository(CreditTransaction);
      const transaction = await transactions.save(
        transactions.create({
          id: randomUUID(),
          type: 'TRANSFER',
          amount: transferredAmount,
          originBalanceType: 'RESERVED_BALANCE',
          destinationBalanceType: 'CREDIT_BALANCE',
          originUserId: operation.requesterUserId,
          destinationUserId: operation.courierUserId,
          errandId: operation.errandId,
        }),
      );

      reservation.status = 'CONSUMED';
      reservation.latestTransactionId = transaction.id;
      await reservations.save(reservation);

      return this.completeSuccess(manager, operation, transaction);
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

  private async completeSuccess(
    manager: EntityManager,
    operation: TransferOperation,
    transaction: CreditTransaction,
  ): Promise<TransferProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditTransferSucceededEvent = {
      eventId,
      eventType: 'CreditTransferSucceeded',
      timestamp: transaction.createdAt.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        courierUserId: operation.courierUserId,
        transferredAmount: transaction.amount,
        creditTransactionId: transaction.id,
      },
    };
    await this.saveOutbox(
      manager,
      event,
      CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
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
    operation: TransferOperation,
    reason: SupportedTransferRejectionReason,
  ): Promise<TransferProcessingOutcome> {
    const eventId = randomUUID();
    const event: CreditTransferRejectedEvent = {
      eventId,
      eventType: 'CreditTransferRejected',
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
      CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
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
    operation: TransferOperation,
    rejectionReason: SupportedTransferRejectionReason | null,
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
    event: CreditTransferSucceededEvent | CreditTransferRejectedEvent,
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
