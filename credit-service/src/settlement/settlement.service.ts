import { createHash, randomUUID } from 'node:crypto';
import {
  CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY,
  CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY,
  type CreditSettlementEvent,
  type CreditSettlementRejectedEvent,
  type CreditSettlementRejectionReason,
  type CreditSettlementSucceededEvent,
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

export type CreditSettlementIngressOutcome =
  | {
      status: 'accepted' | 'semantic-replay-pending';
      eventId: string;
      operationId: string;
    }
  | {
      status: 'semantic-replay-completed';
      eventId: string;
      operationId: string;
      requesterTransactionId: string | null;
      courierTransactionId: string | null;
      outboxEventId: string;
    }
  | {
      status: 'duplicate-event';
      eventId: string;
      operationId: string | null;
      outboxEventId: string | null;
    }
  | {
      status: 'event-id-conflict' | 'attempt-conflict' | 'invalid-command';
      eventId: string;
      reason: string;
    };

type SettlementOutcomeEvent =
  | CreditSettlementSucceededEvent
  | CreditSettlementRejectedEvent;

type SettlementOperation = CreditOperation & {
  requesterUserId: string;
  courierUserId: string;
  amount: number;
  settlementAttempt: number;
  requesterAmount: number;
  courierAmount: number;
};

const SETTLEMENT_REJECTION_REASONS =
  new Set<CreditSettlementRejectionReason>([
    'ALREADY_TRANSFERRED',
    'AMOUNT_MISMATCH',
    'RESERVATION_NOT_FOUND',
    'RESERVATION_RELEASED',
    'RESERVATION_USER_MISMATCH',
  ]);

export class CreditSettlementIngressInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditSettlementIngressInvariantError';
  }
}

export function hashCreditSettlementPayload(
  payload: CreditSettlementEvent['payload'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        errandId: payload.errandId,
        requesterUserId: payload.requesterUserId,
        courierUserId: payload.courierUserId,
        courierAmount: payload.courierAmount,
        requesterAmount: payload.requesterAmount,
        attempt: payload.attempt,
      }),
    )
    .digest('hex');
}

function invalidCommandReason(
  payload: CreditSettlementEvent['payload'],
): string | null {
  if (payload.requesterUserId === payload.courierUserId) {
    return 'requester and courier must be distinct users';
  }
  if (
    !Number.isSafeInteger(payload.courierAmount) ||
    payload.courierAmount < 0 ||
    !Number.isSafeInteger(payload.requesterAmount) ||
    payload.requesterAmount < 0 ||
    !Number.isSafeInteger(payload.attempt) ||
    payload.attempt <= 0
  ) {
    return 'shares and attempt must be JavaScript-safe integers';
  }
  const total = payload.courierAmount + payload.requesterAmount;
  if (!Number.isSafeInteger(total) || total <= 0) {
    return 'settlement total must be a positive JavaScript-safe integer';
  }
  return null;
}

function assertSettlementOperation(
  operation: CreditOperation,
): asserts operation is SettlementOperation {
  if (
    operation.operationType !== 'SETTLEMENT' ||
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
    throw new CreditSettlementIngressInvariantError(
      'Settlement operation has invalid participant, attempt, or share context',
    );
  }
}

function rejectionReason(
  operation: CreditOperation,
): CreditSettlementRejectionReason {
  const reason = operation.rejectionReason as CreditSettlementRejectionReason;
  if (!reason || !SETTLEMENT_REJECTION_REASONS.has(reason)) {
    throw new CreditSettlementIngressInvariantError(
      'Rejected settlement operation has no supported rejection reason',
    );
  }
  return reason;
}

/** Persists a validated settlement request before financial execution. */
@Injectable()
export class SettlementService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async accept(
    command: CreditSettlementEvent,
  ): Promise<CreditSettlementIngressOutcome> {
    const invalidReason = invalidCommandReason(command.payload);
    return this.transactions.run(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.eventId],
      );

      const payloadHash = hashCreditSettlementPayload(command.payload);
      const inbox = manager.getRepository(InboxEvent);
      const establishedEvent = await inbox.findOneBy({
        eventId: command.eventId,
      });
      if (establishedEvent) {
        if (
          establishedEvent.eventType !== command.eventType ||
          establishedEvent.payloadHash !== payloadHash
        ) {
          return {
            status: 'event-id-conflict',
            eventId: command.eventId,
            reason: 'event ID was previously processed with different content',
          };
        }
        return {
          status: 'duplicate-event',
          eventId: command.eventId,
          operationId: establishedEvent.outcomeOperationId,
          outboxEventId: establishedEvent.outcomeOutboxEventId,
        };
      }

      if (invalidReason) {
        return {
          status: 'invalid-command',
          eventId: command.eventId,
          reason: invalidReason,
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
          operationType: 'SETTLEMENT',
          settlementAttempt: command.payload.attempt,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!establishedOperation) {
        const amount =
          command.payload.requesterAmount + command.payload.courierAmount;
        const operation = await operations.save(
          operations.create({
            id: randomUUID(),
            errandId: command.payload.errandId,
            operationType: 'SETTLEMENT',
            status: 'PENDING',
            requesterUserId: command.payload.requesterUserId,
            courierUserId: command.payload.courierUserId,
            amount,
            expectedAmount: null,
            commandEventId: null,
            settlementAttempt: command.payload.attempt,
            requesterAmount: command.payload.requesterAmount,
            courierAmount: command.payload.courierAmount,
            requestPayloadHash: payloadHash,
            attemptCount: 0,
            nextAttemptAt: new Date(),
            claimedBy: null,
            claimedUntil: null,
            lastError: null,
            rejectionReason: null,
            completionTransactionId: null,
            requesterTransactionId: null,
            courierTransactionId: null,
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

      assertSettlementOperation(establishedOperation);
      if (establishedOperation.requestPayloadHash !== payloadHash) {
        return {
          status: 'attempt-conflict',
          eventId: command.eventId,
          reason: 'settlement attempt was previously accepted with different content',
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
        const [requesterTransaction, courierTransaction] = await Promise.all([
          this.loadTransaction(
            manager,
            establishedOperation.requesterTransactionId,
          ),
          this.loadTransaction(
            manager,
            establishedOperation.courierTransactionId,
          ),
        ]);
        this.assertSuccessfulTransactions(
          establishedOperation,
          requesterTransaction,
          courierTransaction,
        );
        const outboxEventId = await this.recordSuccess(
          manager,
          command,
          payloadHash,
          establishedOperation,
        );
        return {
          status: 'semantic-replay-completed',
          eventId: command.eventId,
          operationId: establishedOperation.id,
          requesterTransactionId:
            establishedOperation.requesterTransactionId,
          courierTransactionId: establishedOperation.courierTransactionId,
          outboxEventId,
        };
      }

      const outboxEventId = await this.recordRejection(
        manager,
        command,
        payloadHash,
        establishedOperation,
        rejectionReason(establishedOperation),
      );
      return {
        status: 'semantic-replay-completed',
        eventId: command.eventId,
        operationId: establishedOperation.id,
        requesterTransactionId: null,
        courierTransactionId: null,
        outboxEventId,
      };
    });
  }

  private async loadTransaction(
    manager: EntityManager,
    transactionId: string | null,
  ): Promise<CreditTransaction | null> {
    return transactionId
      ? manager.getRepository(CreditTransaction).findOneBy({
          id: transactionId,
        })
      : null;
  }

  private assertSuccessfulTransactions(
    operation: SettlementOperation,
    requesterTransaction: CreditTransaction | null,
    courierTransaction: CreditTransaction | null,
  ): void {
    const requesterValid =
      operation.requesterAmount === 0
        ? operation.requesterTransactionId === null &&
          requesterTransaction === null
        : !!requesterTransaction &&
          requesterTransaction.id === operation.requesterTransactionId &&
          requesterTransaction.type === 'RELEASE' &&
          requesterTransaction.amount === operation.requesterAmount &&
          requesterTransaction.errandId === operation.errandId &&
          requesterTransaction.originUserId === operation.requesterUserId &&
          requesterTransaction.destinationUserId === operation.requesterUserId;
    const courierValid =
      operation.courierAmount === 0
        ? operation.courierTransactionId === null && courierTransaction === null
        : !!courierTransaction &&
          courierTransaction.id === operation.courierTransactionId &&
          courierTransaction.type === 'TRANSFER' &&
          courierTransaction.amount === operation.courierAmount &&
          courierTransaction.errandId === operation.errandId &&
          courierTransaction.originUserId === operation.requesterUserId &&
          courierTransaction.destinationUserId === operation.courierUserId;

    if (!requesterValid || !courierValid) {
      throw new CreditSettlementIngressInvariantError(
        'Successful settlement operation has inconsistent transactions',
      );
    }
  }

  private async recordSuccess(
    manager: EntityManager,
    command: CreditSettlementEvent,
    payloadHash: string,
    operation: SettlementOperation,
  ): Promise<string> {
    const eventId = randomUUID();
    const event: CreditSettlementSucceededEvent = {
      eventId,
      eventType: 'CreditSettlementSucceeded',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: operation.errandId,
        requesterUserId: operation.requesterUserId,
        courierUserId: operation.courierUserId,
        courierAmount: operation.courierAmount,
        requesterAmount: operation.requesterAmount,
        courierCreditTransactionId: operation.courierTransactionId,
        requesterCreditTransactionId: operation.requesterTransactionId,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      operation.id,
      event,
      CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY,
    );
    return eventId;
  }

  private async recordRejection(
    manager: EntityManager,
    command: CreditSettlementEvent,
    payloadHash: string,
    operation: SettlementOperation,
    reason: CreditSettlementRejectionReason,
  ): Promise<string> {
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
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      operation.id,
      event,
      CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY,
    );
    return eventId;
  }

  private async recordOutcome(
    manager: EntityManager,
    command: CreditSettlementEvent,
    payloadHash: string,
    operationId: string,
    event: SettlementOutcomeEvent,
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
    await this.recordInbox(
      manager,
      command,
      payloadHash,
      operationId,
      event.eventId,
    );
  }

  private async recordInbox(
    manager: EntityManager,
    command: CreditSettlementEvent,
    payloadHash: string,
    operationId: string,
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
        outcomeTransactionId: null,
        outcomeOutboxEventId: outboxEventId,
      }),
    );
  }
}
