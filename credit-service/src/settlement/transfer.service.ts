import { createHash, randomUUID } from 'node:crypto';
import {
  CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
  CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
  type CreditTransferRejectedEvent,
  type CreditTransferRejectionReason,
  type CreditTransferSucceededEvent,
  type ErrandCompletedEvent,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CreditOperation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export type CreditTransferIngressOutcome =
  | {
      status: 'accepted' | 'semantic-replay-pending';
      eventId: string;
      operationId: string;
    }
  | {
      status: 'semantic-replay-completed';
      eventId: string;
      operationId: string;
      transactionId: string | null;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      eventId: string;
      reason: 'RESERVATION_USER_MISMATCH';
      outboxEventId: string;
    }
  | {
      status: 'duplicate-event';
      eventId: string;
      operationId: string | null;
      transactionId: string | null;
      outboxEventId: string | null;
    }
  | { status: 'event-id-conflict'; eventId: string };

type TransferOutcomeEvent =
  CreditTransferSucceededEvent | CreditTransferRejectedEvent;

const TRANSFER_REJECTION_REASONS = new Set<CreditTransferRejectionReason>([
  'RESERVATION_NOT_FOUND',
  'RESERVATION_RELEASED',
  'RESERVATION_USER_MISMATCH',
]);

export class CreditTransferIngressInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditTransferIngressInvariantError';
  }
}

export function hashErrandCompletedPayload(
  payload: ErrandCompletedEvent['payload'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        errandId: payload.errandId,
        requesterUserId: payload.requesterUserId,
        courierUserId: payload.courierUserId,
        amount: payload.amount,
      }),
    )
    .digest('hex');
}

function assertValidAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(
      'Completion amount must be a positive JavaScript-safe integer',
    );
  }
}

function rejectionReason(operation: CreditOperation) {
  const reason = operation.rejectionReason as CreditTransferRejectionReason;
  if (!reason || !TRANSFER_REJECTION_REASONS.has(reason)) {
    throw new CreditTransferIngressInvariantError(
      'Rejected transfer operation has no supported rejection reason',
    );
  }
  return reason;
}

/** Persists a validated completion notice before financial execution. */
@Injectable()
export class TransferService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async accept(
    command: ErrandCompletedEvent,
  ): Promise<CreditTransferIngressOutcome> {
    assertValidAmount(command.payload.amount);

    return this.transactions.run(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.eventId],
      );

      const payloadHash = hashErrandCompletedPayload(command.payload);
      const inbox = manager.getRepository(InboxEvent);
      const establishedEvent = await inbox.findOneBy({
        eventId: command.eventId,
      });
      if (establishedEvent) {
        if (
          establishedEvent.eventType !== command.eventType ||
          establishedEvent.payloadHash !== payloadHash
        ) {
          return { status: 'event-id-conflict', eventId: command.eventId };
        }
        return {
          status: 'duplicate-event',
          eventId: command.eventId,
          operationId: establishedEvent.outcomeOperationId,
          transactionId: establishedEvent.outcomeTransactionId,
          outboxEventId: establishedEvent.outcomeOutboxEventId,
        };
      }

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.payload.errandId],
      );

      const operations = manager.getRepository(CreditOperation);
      const establishedOperation = await operations.findOne({
        where: {
          errandId: command.payload.errandId,
          operationType: 'TRANSFER',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!establishedOperation) {
        const operation = await operations.save(
          operations.create({
            id: randomUUID(),
            errandId: command.payload.errandId,
            operationType: 'TRANSFER',
            status: 'PENDING',
            requesterUserId: command.payload.requesterUserId,
            courierUserId: command.payload.courierUserId,
            amount: command.payload.amount,
            expectedAmount: null,
            commandEventId: null,
            requestPayloadHash: payloadHash,
            attemptCount: 0,
            nextAttemptAt: new Date(),
            claimedBy: null,
            claimedUntil: null,
            lastError: null,
            rejectionReason: null,
            completionTransactionId: null,
            outcomeOutboxEventId: null,
          }),
        );
        await this.recordInbox(manager, command, payloadHash, operation.id);
        return {
          status: 'accepted',
          eventId: command.eventId,
          operationId: operation.id,
        };
      }

      if (
        establishedOperation.requesterUserId !==
          command.payload.requesterUserId ||
        establishedOperation.courierUserId !== command.payload.courierUserId
      ) {
        const outboxEventId = await this.recordRejection(
          manager,
          command,
          payloadHash,
          'RESERVATION_USER_MISMATCH',
          null,
        );
        return {
          status: 'rejected',
          eventId: command.eventId,
          reason: 'RESERVATION_USER_MISMATCH',
          outboxEventId,
        };
      }

      if (establishedOperation.status === 'PENDING') {
        await this.recordInbox(
          manager,
          command,
          payloadHash,
          establishedOperation.id,
        );
        return {
          status: 'semantic-replay-pending',
          eventId: command.eventId,
          operationId: establishedOperation.id,
        };
      }

      if (establishedOperation.status === 'SUCCEEDED') {
        const transactionId = establishedOperation.completionTransactionId;
        if (!transactionId) {
          throw new CreditTransferIngressInvariantError(
            'Successful transfer operation has no transaction',
          );
        }
        const transaction = await manager
          .getRepository(CreditTransaction)
          .findOneBy({ id: transactionId });
        this.assertTransferTransaction(establishedOperation, transaction);
        const outboxEventId = await this.recordSuccess(
          manager,
          command,
          payloadHash,
          establishedOperation.id,
          transaction,
        );
        return {
          status: 'semantic-replay-completed',
          eventId: command.eventId,
          operationId: establishedOperation.id,
          transactionId,
          outboxEventId,
        };
      }

      const outboxEventId = await this.recordRejection(
        manager,
        command,
        payloadHash,
        rejectionReason(establishedOperation),
        establishedOperation.id,
      );
      return {
        status: 'semantic-replay-completed',
        eventId: command.eventId,
        operationId: establishedOperation.id,
        transactionId: null,
        outboxEventId,
      };
    });
  }

  private assertTransferTransaction(
    operation: CreditOperation,
    transaction: CreditTransaction | null,
  ): asserts transaction is CreditTransaction {
    if (
      !transaction ||
      transaction.type !== 'TRANSFER' ||
      transaction.errandId !== operation.errandId ||
      transaction.originUserId !== operation.requesterUserId ||
      transaction.destinationUserId !== operation.courierUserId
    ) {
      throw new CreditTransferIngressInvariantError(
        'Successful transfer operation has an inconsistent transaction',
      );
    }
  }

  private async recordSuccess(
    manager: EntityManager,
    command: ErrandCompletedEvent,
    payloadHash: string,
    operationId: string,
    transaction: CreditTransaction,
  ): Promise<string> {
    const eventId = randomUUID();
    const event: CreditTransferSucceededEvent = {
      eventId,
      eventType: 'CreditTransferSucceeded',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: command.payload.requesterUserId,
        courierUserId: command.payload.courierUserId,
        transferredAmount: transaction.amount,
        creditTransactionId: transaction.id,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
      operationId,
      transaction.id,
    );
    return eventId;
  }

  private async recordRejection(
    manager: EntityManager,
    command: ErrandCompletedEvent,
    payloadHash: string,
    reason: CreditTransferRejectionReason,
    operationId: string | null,
  ): Promise<string> {
    const eventId = randomUUID();
    const event: CreditTransferRejectedEvent = {
      eventId,
      eventType: 'CreditTransferRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: command.payload.requesterUserId,
        courierUserId: command.payload.courierUserId,
        rejectionReason: reason,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
      operationId,
      null,
    );
    return eventId;
  }

  private async recordOutcome(
    manager: EntityManager,
    command: ErrandCompletedEvent,
    payloadHash: string,
    event: TransferOutcomeEvent,
    routingKey: string,
    operationId: string | null,
    transactionId: string | null,
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
    await this.recordInbox(
      manager,
      command,
      payloadHash,
      operationId,
      transactionId,
      event.eventId,
    );
  }

  private async recordInbox(
    manager: EntityManager,
    command: ErrandCompletedEvent,
    payloadHash: string,
    operationId: string | null,
    transactionId: string | null = null,
    outboxEventId: string | null = null,
  ): Promise<void> {
    const inbox = manager.getRepository(InboxEvent);
    await inbox.save(
      inbox.create({
        eventId: command.eventId,
        eventType: command.eventType,
        payloadHash,
        processedAt: new Date(),
        outcomeAllocationId: null,
        outcomeOperationId: operationId,
        outcomeTransactionId: transactionId,
        outcomeOutboxEventId: outboxEventId,
      }),
    );
  }
}
