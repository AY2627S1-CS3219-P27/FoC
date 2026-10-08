import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CreditAccount,
  CreditReservation,
  CreditTransaction,
  InboxEvent,
  OutboxEvent,
} from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export const CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY =
  'credit.reservation-adjustment-success.v1';
export const CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY =
  'credit.reservation-adjustment-rejected.v1';

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

export type CreditReservationAdjustmentOutcome =
  | {
      status: 'adjusted' | 'no-op';
      eventId: string;
      reservationId: string;
      transactionId: string;
      outboxEventId: string;
    }
  | {
      status: 'rejected';
      eventId: string;
      reason: CreditReservationAdjustmentRejectionReason;
      outboxEventId: string;
    }
  | {
      status: 'duplicate-event';
      eventId: string;
      transactionId: string | null;
      outboxEventId: string;
    }
  | { status: 'event-id-conflict'; eventId: string };

interface CreditReservationAdjustmentSuccessEvent {
  eventId: string;
  eventType: 'CreditReservationAdjustmentSuccess';
  timestamp: string;
  publisher: 'credit-service';
  payload: {
    errandId: string;
    newReservedAmount: number;
    creditTransactionId: string;
  };
}

interface CreditReservationAdjustmentRejectedEvent {
  eventId: string;
  eventType: 'CreditReservationAdjustmentRejected';
  timestamp: string;
  publisher: 'credit-service';
  payload: {
    errandId: string;
    requestedAmount: number;
    rejectionReason: CreditReservationAdjustmentRejectionReason;
  };
}

type CreditReservationAdjustmentOutcomeEvent =
  | CreditReservationAdjustmentSuccessEvent
  | CreditReservationAdjustmentRejectedEvent;

export class CreditReservationAdjustmentInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditReservationAdjustmentInvariantError';
  }
}

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

/** Applies one event-ID-deduplicated adjustment in a serializable transaction. */
@Injectable()
export class ReservationAdjustmentService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async adjust(
    command: CreditReservationAdjustmentCommand,
  ): Promise<CreditReservationAdjustmentOutcome> {
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
        if (!establishedEvent.outcomeOutboxEventId) {
          throw new CreditReservationAdjustmentInvariantError(
            'Adjustment inbox outcome has no outbox event',
          );
        }
        return {
          status: 'duplicate-event',
          eventId: command.eventId,
          transactionId: establishedEvent.outcomeTransactionId,
          outboxEventId: establishedEvent.outcomeOutboxEventId,
        };
      }

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [command.payload.errandId],
      );

      const reservations = manager.getRepository(CreditReservation);
      const reservation = await reservations.findOne({
        where: { errandId: command.payload.errandId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reservation || reservation.status !== 'ACTIVE') {
        return this.reject(
          manager,
          command,
          payloadHash,
          'RESERVATION_NOT_FOUND',
        );
      }
      if (reservation.reservedAmount !== command.payload.oldAmount) {
        return this.reject(
          manager,
          command,
          payloadHash,
          'STALE_RESERVATION_AMOUNT',
        );
      }
      if (command.payload.newAmount === command.payload.oldAmount) {
        const outboxEventId = await this.recordSuccess(
          manager,
          command,
          payloadHash,
          reservation.latestTransactionId,
        );
        return {
          status: 'no-op',
          eventId: command.eventId,
          reservationId: reservation.id,
          transactionId: reservation.latestTransactionId,
          outboxEventId,
        };
      }

      const accounts = manager.getRepository(CreditAccount);
      const account = await accounts.findOne({
        where: { userId: reservation.requesterUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new CreditReservationAdjustmentInvariantError(
          'Active reservation has no requester credit account',
        );
      }

      const difference = command.payload.newAmount - command.payload.oldAmount;
      if (difference > 0 && account.creditBalance < difference) {
        return this.reject(
          manager,
          command,
          payloadHash,
          'INSUFFICIENT_CREDITS',
        );
      }

      const nextCreditBalance = account.creditBalance - difference;
      const nextReservedBalance = account.reservedBalance + difference;
      assertSafeBalances(nextCreditBalance, nextReservedBalance);
      account.creditBalance = nextCreditBalance;
      account.reservedBalance = nextReservedBalance;
      await accounts.save(account);

      const movements = manager.getRepository(CreditTransaction);
      const transaction = await movements.save(
        movements.create({
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

      reservation.reservedAmount = command.payload.newAmount;
      reservation.latestTransactionId = transaction.id;
      await reservations.save(reservation);

      const outboxEventId = await this.recordSuccess(
        manager,
        command,
        payloadHash,
        transaction.id,
        transaction.createdAt,
      );
      return {
        status: 'adjusted',
        eventId: command.eventId,
        reservationId: reservation.id,
        transactionId: transaction.id,
        outboxEventId,
      };
    });
  }

  private async reject(
    manager: EntityManager,
    command: CreditReservationAdjustmentCommand,
    payloadHash: string,
    reason: CreditReservationAdjustmentRejectionReason,
  ): Promise<
    Extract<CreditReservationAdjustmentOutcome, { status: 'rejected' }>
  > {
    const outboxEventId = randomUUID();
    const event: CreditReservationAdjustmentRejectedEvent = {
      eventId: outboxEventId,
      eventType: 'CreditReservationAdjustmentRejected',
      timestamp: new Date().toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        requestedAmount: command.payload.newAmount,
        rejectionReason: reason,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY,
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
    command: CreditReservationAdjustmentCommand,
    payloadHash: string,
    transactionId: string,
    occurredAt = new Date(),
  ): Promise<string> {
    const outboxEventId = randomUUID();
    const event: CreditReservationAdjustmentSuccessEvent = {
      eventId: outboxEventId,
      eventType: 'CreditReservationAdjustmentSuccess',
      timestamp: occurredAt.toISOString(),
      publisher: 'credit-service',
      payload: {
        errandId: command.payload.errandId,
        newReservedAmount: command.payload.newAmount,
        creditTransactionId: transactionId,
      },
    };
    await this.recordOutcome(
      manager,
      command,
      payloadHash,
      event,
      CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY,
      transactionId,
    );
    return outboxEventId;
  }

  private async recordOutcome(
    manager: EntityManager,
    command: CreditReservationAdjustmentCommand,
    payloadHash: string,
    event: CreditReservationAdjustmentOutcomeEvent,
    routingKey: string,
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

    const inbox = manager.getRepository(InboxEvent);
    await inbox.save(
      inbox.create({
        eventId: command.eventId,
        eventType: command.eventType,
        payloadHash,
        processedAt: new Date(),
        outcomeAllocationId: null,
        outcomeOperationId: null,
        outcomeTransactionId: transactionId,
        outcomeOutboxEventId: event.eventId,
      }),
    );
  }
}
