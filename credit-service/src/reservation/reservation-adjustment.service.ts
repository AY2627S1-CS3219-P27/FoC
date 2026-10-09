import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CreditOperation, InboxEvent } from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export type CreditReservationAdjustmentRejectionReason =
  'RESERVATION_NOT_FOUND' | 'STALE_RESERVATION_AMOUNT' | 'INSUFFICIENT_CREDITS';

export interface CreditReservationAdjustmentCommand {
  eventId: string;
  eventType: 'CreditReservationAdjustment';
  timestamp: string;
  publisher: 'order-service';
  payload: {
    errandId: string;
    oldAmount: number;
    newAmount: number;
  };
}

export type CreditReservationAdjustmentIngressOutcome =
  | {
      status: 'accepted';
      eventId: string;
      operationId: string;
    }
  | {
      status: 'duplicate-event';
      eventId: string;
      operationId: string;
      transactionId: string | null;
      outboxEventId: string | null;
    }
  | { status: 'event-id-conflict'; eventId: string };

export function hashCreditReservationAdjustmentPayload(
  payload: CreditReservationAdjustmentCommand['payload'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        errandId: payload.errandId,
        oldAmount: payload.oldAmount,
        newAmount: payload.newAmount,
      }),
    )
    .digest('hex');
}

function assertValidAmount(label: string, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`${label} must be a positive JavaScript-safe integer`);
  }
}

/** Persists an adjustment command before transport acknowledgement. */
@Injectable()
export class ReservationAdjustmentService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async accept(
    command: CreditReservationAdjustmentCommand,
  ): Promise<CreditReservationAdjustmentIngressOutcome> {
    assertValidAmount('Previous reservation amount', command.payload.oldAmount);
    assertValidAmount('New reservation amount', command.payload.newAmount);

    return this.transactions.run(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.eventId],
      );

      const payloadHash = hashCreditReservationAdjustmentPayload(
        command.payload,
      );
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
        if (!establishedEvent.outcomeOperationId) {
          throw new Error('Adjustment inbox outcome has no operation');
        }
        return {
          status: 'duplicate-event',
          eventId: command.eventId,
          operationId: establishedEvent.outcomeOperationId,
          transactionId: establishedEvent.outcomeTransactionId,
          outboxEventId: establishedEvent.outcomeOutboxEventId,
        };
      }

      const operations = manager.getRepository(CreditOperation);
      const operation = await operations.save(
        operations.create({
          id: randomUUID(),
          errandId: command.payload.errandId,
          operationType: 'ADJUST',
          status: 'PENDING',
          requesterUserId: null,
          courierUserId: null,
          amount: command.payload.newAmount,
          expectedAmount: command.payload.oldAmount,
          commandEventId: command.eventId,
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
    });
  }

  private async recordInbox(
    manager: EntityManager,
    command: CreditReservationAdjustmentCommand,
    payloadHash: string,
    operationId: string,
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
        outcomeOutboxEventId: null,
      }),
    );
  }
}
