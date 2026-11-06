import { createHash, randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
  CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
  type CreditReleaseRejectedEvent,
  type CreditReleaseRejectionReason,
  type CreditReleaseSuccessEvent,
  type ErrandCancelledEvent,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CreditOperation,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export type CreditReleaseIngressOutcome =
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
      status: 'duplicate-event';
      eventId: string;
      operationId: string | null;
      transactionId: string | null;
      outboxEventId: string | null;
    }
  | { status: 'event-id-conflict'; eventId: string };

type ReleaseOutcomeEvent =
  CreditReleaseSuccessEvent | CreditReleaseRejectedEvent;

type ReleaseContext = { requesterUserId: string; amount: number };

const RELEASE_REJECTION_REASONS = new Set<CreditReleaseRejectionReason>([
  'RESERVATION_NOT_FOUND',
  'ALREADY_TRANSFERRED',
]);

export class CreditReleaseIngressInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditReleaseIngressInvariantError';
  }
}

export function hashErrandCancelledPayload(
  payload: ErrandCancelledEvent['payload'],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ errandId: payload.errandId }))
    .digest('hex');
}

function requireContext(
  requesterUserId: string | null,
  amount: number | null,
): ReleaseContext {
  if (
    !requesterUserId ||
    !Number.isSafeInteger(amount) ||
    (amount as number) <= 0
  ) {
    throw new CreditReleaseIngressInvariantError(
      'Terminal release operation has incomplete requester or amount context',
    );
  }
  return { requesterUserId, amount: amount as number };
}

function rejectionReason(operation: CreditOperation) {
  const reason = operation.rejectionReason as CreditReleaseRejectionReason;
  if (!reason || !RELEASE_REJECTION_REASONS.has(reason)) {
    throw new CreditReleaseIngressInvariantError(
      'Rejected release operation has no supported rejection reason',
    );
  }
  return reason;
}

/** Persists a validated cancellation before financial release execution. */
@Injectable()
export class ReleaseService {
  constructor(
    private readonly transactions: SerializableTransactionRunner,
    private readonly contracts: AccountEventContractValidator,
  ) {}

  async accept(
    command: ErrandCancelledEvent,
  ): Promise<CreditReleaseIngressOutcome> {
    return this.transactions.run(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.eventId],
      );

      const payloadHash = hashErrandCancelledPayload(command.payload);
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
          operationType: 'RELEASE',
        },
        lock: { mode: 'pessimistic_write' },
      });
      const context = await this.discoverContext(
        manager,
        command.payload.errandId,
      );

      if (!establishedOperation) {
        const operation = await operations.save(
          operations.create({
            id: randomUUID(),
            errandId: command.payload.errandId,
            operationType: 'RELEASE',
            status: 'PENDING',
            requesterUserId: context?.requesterUserId ?? null,
            courierUserId: null,
            amount: context?.amount ?? null,
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

      await this.enrichOperation(manager, establishedOperation, context);

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

      requireContext(
        establishedOperation.requesterUserId,
        establishedOperation.amount,
      );
      if (!establishedOperation.outcomeOutboxEventId) {
        throw new CreditReleaseIngressInvariantError(
          'Terminal release operation has no outcome outbox event',
        );
      }

      if (establishedOperation.status === 'SUCCEEDED') {
        const transactionId = establishedOperation.completionTransactionId;
        if (!transactionId) {
          throw new CreditReleaseIngressInvariantError(
            'Successful release operation has no transaction',
          );
        }
        const transaction = await manager
          .getRepository(CreditTransaction)
          .findOneBy({ id: transactionId });
        this.assertReleaseTransaction(establishedOperation, transaction);
        await this.assertSuccessOutcome(
          manager,
          establishedOperation,
          transaction,
        );
        const outboxEventId = await this.recordSuccess(
          manager,
          command,
          payloadHash,
          establishedOperation,
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

      const reason = rejectionReason(establishedOperation);
      await this.assertRejectedOutcome(manager, establishedOperation, reason);
      const outboxEventId = await this.recordRejection(
        manager,
        command,
        payloadHash,
        establishedOperation,
        reason,
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

  private async discoverContext(
    manager: EntityManager,
    errandId: string,
  ): Promise<ReleaseContext | null> {
    const reservation = await manager
      .getRepository(CreditReservation)
      .findOneBy({ errandId });
    // This read must remain non-locking. Reserve execution locks its operation
    // before taking the errand advisory lock, while release ingress already
    // holds that advisory lock.
    const reserveOperation = await manager
      .getRepository(CreditOperation)
      .findOneBy({ errandId, operationType: 'RESERVE' });

    const reserveContext = reserveOperation
      ? requireContext(
          reserveOperation.requesterUserId,
          reserveOperation.amount,
        )
      : null;
    if (reservation) {
      if (
        reserveContext?.requesterUserId &&
        reserveContext.requesterUserId !== reservation.requesterUserId
      ) {
        throw new CreditReleaseIngressInvariantError(
          'Reservation and reserve operation disagree on requester',
        );
      }
      return {
        requesterUserId: reservation.requesterUserId,
        amount: reservation.reservedAmount,
      };
    }
    if (reserveContext) {
      return reserveContext;
    }
    return null;
  }

  private async enrichOperation(
    manager: EntityManager,
    operation: CreditOperation,
    context: ReleaseContext | null,
  ): Promise<void> {
    if (!context) {
      return;
    }
    if (
      operation.requesterUserId &&
      operation.requesterUserId !== context.requesterUserId
    ) {
      throw new CreditReleaseIngressInvariantError(
        'Release operation and discovered context disagree on requester',
      );
    }
    if (operation.status !== 'PENDING') {
      if (operation.amount !== null && operation.amount !== context.amount) {
        throw new CreditReleaseIngressInvariantError(
          'Release operation and discovered context disagree on amount',
        );
      }
      return;
    }

    const changed =
      operation.requesterUserId === null || operation.amount !== context.amount;
    operation.requesterUserId ??= context.requesterUserId;
    operation.amount = context.amount;
    if (changed) {
      await manager.getRepository(CreditOperation).save(operation);
    }
  }

  private assertReleaseTransaction(
    operation: CreditOperation,
    transaction: CreditTransaction | null,
  ): asserts transaction is CreditTransaction {
    if (
      !transaction ||
      transaction.type !== 'RELEASE' ||
      transaction.errandId !== operation.errandId ||
      transaction.originUserId !== operation.requesterUserId ||
      transaction.destinationUserId !== operation.requesterUserId ||
      transaction.amount !== operation.amount ||
      transaction.originBalanceType !== 'RESERVED_BALANCE' ||
      transaction.destinationBalanceType !== 'CREDIT_BALANCE'
    ) {
      throw new CreditReleaseIngressInvariantError(
        'Successful release operation has an inconsistent transaction',
      );
    }
  }

  private async assertSuccessOutcome(
    manager: EntityManager,
    operation: CreditOperation,
    transaction: CreditTransaction,
  ): Promise<void> {
    const outcome = await manager.getRepository(OutboxEvent).findOneBy({
      eventId: operation.outcomeOutboxEventId!,
    });
    const validation = outcome
      ? this.contracts.validate(
          CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
          outcome.envelope,
        )
      : null;
    if (
      !outcome ||
      outcome.eventType !== 'CreditReleaseSuccess' ||
      outcome.routingKey !== CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY ||
      !validation?.valid ||
      validation.value.eventId !== outcome.eventId ||
      validation.value.timestamp !== transaction.createdAt.toISOString() ||
      validation.value.payload.errandId !== operation.errandId ||
      validation.value.payload.requesterUserId !== operation.requesterUserId ||
      validation.value.payload.releasedAmount !== operation.amount ||
      validation.value.payload.creditTransactionId !== transaction.id
    ) {
      throw new CreditReleaseIngressInvariantError(
        'Successful release operation has inconsistent outbox evidence',
      );
    }
  }

  private async assertRejectedOutcome(
    manager: EntityManager,
    operation: CreditOperation,
    reason: CreditReleaseRejectionReason,
  ): Promise<void> {
    const outcome = await manager.getRepository(OutboxEvent).findOneBy({
      eventId: operation.outcomeOutboxEventId!,
    });
    const validation = outcome
      ? this.contracts.validate(
          CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
          outcome.envelope,
        )
      : null;
    if (
      !outcome ||
      outcome.eventType !== 'CreditReleaseRejected' ||
      outcome.routingKey !== CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY ||
      !validation?.valid ||
      validation.value.eventId !== outcome.eventId ||
      validation.value.payload.errandId !== operation.errandId ||
      validation.value.payload.requesterUserId !== operation.requesterUserId ||
      validation.value.payload.rejectionReason !== reason
    ) {
      throw new CreditReleaseIngressInvariantError(
        'Rejected release operation has inconsistent outbox evidence',
      );
    }
  }

  private async recordSuccess(
    manager: EntityManager,
    command: ErrandCancelledEvent,
    payloadHash: string,
    operation: CreditOperation,
    transaction: CreditTransaction,
  ): Promise<string> {
    const context = requireContext(operation.requesterUserId, operation.amount);
    const eventId = randomUUID();
    const event: CreditReleaseSuccessEvent = {
      eventId,
      eventType: 'CreditReleaseSuccess',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: context.requesterUserId,
        releasedAmount: transaction.amount,
        creditTransactionId: transaction.id,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
      operation.id,
      transaction.id,
    );
    return eventId;
  }

  private async recordRejection(
    manager: EntityManager,
    command: ErrandCancelledEvent,
    payloadHash: string,
    operation: CreditOperation,
    reason: CreditReleaseRejectionReason,
  ): Promise<string> {
    const context = requireContext(operation.requesterUserId, operation.amount);
    const eventId = randomUUID();
    const event: CreditReleaseRejectedEvent = {
      eventId,
      eventType: 'CreditReleaseRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: context.requesterUserId,
        rejectionReason: reason,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
      operation.id,
      null,
    );
    return eventId;
  }

  private async recordOutcome(
    manager: EntityManager,
    command: ErrandCancelledEvent,
    payloadHash: string,
    event: ReleaseOutcomeEvent,
    routingKey: string,
    operationId: string,
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
    command: ErrandCancelledEvent,
    payloadHash: string,
    operationId: string,
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
