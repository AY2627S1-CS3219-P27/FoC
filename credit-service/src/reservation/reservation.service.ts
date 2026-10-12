import { createHash, randomUUID } from 'node:crypto';
import {
  CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CreditOperation,
  InboxEvent,
  OutboxEvent,
} from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export const CREDIT_RESERVATION_SUCCESS_ROUTING_KEY =
  CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY;
export const CREDIT_RESERVATION_REJECTED_ROUTING_KEY =
  CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY;

export type CreditReservationRejectionReason =
  'MISSING_BALANCE' | 'INSUFFICIENT_CREDITS' | 'RESERVATION_CONFLICT';

export interface CreditReservationCommand {
  eventId: string;
  eventType: 'CreditReservation';
  timestamp: string;
  publisher: 'order-service';
  payload: {
    errandId: string;
    requesterUserId: string;
    amount: number;
  };
}

export type CreditReservationIngressOutcome =
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
      reason: CreditReservationRejectionReason;
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

interface CreditReservationSuccessEvent {
  eventId: string;
  eventType: 'CreditReservationSuccess';
  timestamp: string;
  publisher: 'credit-service';
  payload: {
    errandId: string;
    requesterUserId: string;
    reservedAmount: number;
    creditTransactionId: string;
  };
}

interface CreditReservationRejectedEvent {
  eventId: string;
  eventType: 'CreditReservationRejected';
  timestamp: string;
  publisher: 'credit-service';
  payload: {
    errandId: string;
    requesterUserId: string;
    requestedAmount: number;
    rejectionReason: CreditReservationRejectionReason;
  };
}

type CreditReservationOutcomeEvent =
  CreditReservationSuccessEvent | CreditReservationRejectedEvent;

export class CreditReservationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditReservationInvariantError';
  }
}

export function hashCreditReservationPayload(
  payload: CreditReservationCommand['payload'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        errandId: payload.errandId,
        requesterUserId: payload.requesterUserId,
        amount: payload.amount,
      }),
    )
    .digest('hex');
}

function assertValidAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(
      'Reservation amount must be a positive JavaScript-safe integer',
    );
  }
}

/**
 * Persists an already contract-validated CreditReservation command before
 * transport acknowledgement. Financial execution belongs to the worker.
 */
@Injectable()
export class ReservationService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async accept(
    command: CreditReservationCommand,
  ): Promise<CreditReservationIngressOutcome> {
    assertValidAmount(command.payload.amount);

    return this.transactions.run(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.eventId],
      );

      const payloadHash = hashCreditReservationPayload(command.payload);
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
          operationType: 'RESERVE',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!establishedOperation) {
        const operation = await operations.save(
          operations.create({
            id: randomUUID(),
            errandId: command.payload.errandId,
            operationType: 'RESERVE',
            status: 'PENDING',
            requesterUserId: command.payload.requesterUserId,
            courierUserId: null,
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
        establishedOperation.requestPayloadHash !== payloadHash ||
        establishedOperation.requesterUserId !==
          command.payload.requesterUserId ||
        establishedOperation.amount !== command.payload.amount
      ) {
        return this.reject(
          manager,
          command,
          payloadHash,
          'RESERVATION_CONFLICT',
        );
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
        if (!establishedOperation.completionTransactionId) {
          throw new CreditReservationInvariantError(
            'Successful reservation operation has no transaction',
          );
        }
        const outboxEventId = await this.recordSuccess(
          manager,
          command,
          establishedOperation.completionTransactionId,
          payloadHash,
          new Date(),
          establishedOperation.id,
        );
        return {
          status: 'semantic-replay-completed',
          eventId: command.eventId,
          operationId: establishedOperation.id,
          transactionId: establishedOperation.completionTransactionId,
          outboxEventId,
        };
      }

      const reason =
        establishedOperation.rejectionReason as CreditReservationRejectionReason;
      if (!reason) {
        throw new CreditReservationInvariantError(
          'Rejected reservation operation has no rejection reason',
        );
      }
      const replay = await this.reject(
        manager,
        command,
        payloadHash,
        reason,
        establishedOperation.id,
      );
      return {
        status: 'semantic-replay-completed',
        eventId: command.eventId,
        operationId: establishedOperation.id,
        transactionId: null,
        outboxEventId: replay.outboxEventId,
      };
    });
  }

  private async reject(
    manager: EntityManager,
    command: CreditReservationCommand,
    payloadHash: string,
    reason: CreditReservationRejectionReason,
    operationId: string | null = null,
  ): Promise<Extract<CreditReservationIngressOutcome, { status: 'rejected' }>> {
    const outboxEventId = randomUUID();
    const event: CreditReservationRejectedEvent = {
      eventId: outboxEventId,
      eventType: 'CreditReservationRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: command.payload.requesterUserId,
        requestedAmount: command.payload.amount,
        rejectionReason: reason,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RESERVATION_REJECTED_ROUTING_KEY,
      operationId,
      null,
    );

    return {
      status: 'rejected',
      eventId: command.eventId,
      reason,
      outboxEventId,
    };
  }

  private async recordSuccess(
    manager: EntityManager,
    command: CreditReservationCommand,
    transactionId: string,
    payloadHash: string,
    occurredAt = new Date(),
    operationId: string | null = null,
  ): Promise<string> {
    const outboxEventId = randomUUID();
    const event: CreditReservationSuccessEvent = {
      eventId: outboxEventId,
      eventType: 'CreditReservationSuccess',
      timestamp: occurredAt.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requesterUserId: command.payload.requesterUserId,
        reservedAmount: command.payload.amount,
        creditTransactionId: transactionId,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RESERVATION_SUCCESS_ROUTING_KEY,
      operationId,
      transactionId,
    );
    return outboxEventId;
  }

  private async recordOutcome(
    manager: EntityManager,
    command: CreditReservationCommand,
    payloadHash: string,
    event: CreditReservationOutcomeEvent,
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
    command: CreditReservationCommand,
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
