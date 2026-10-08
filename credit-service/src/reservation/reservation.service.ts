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

export const CREDIT_RESERVATION_SUCCESS_ROUTING_KEY =
  'credit.reservation-success.v1';
export const CREDIT_RESERVATION_REJECTED_ROUTING_KEY =
  'credit.reservation-rejected.v1';

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

export type CreditReservationOutcome =
  | {
      status: 'created' | 'existing-reservation';
      eventId: string;
      reservationId: string;
      transactionId: string;
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
      transactionId: string | null;
      outboxEventId: string;
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

/**
 * Applies an already contract-validated CreditReservation command and records
 * its durable business outcome in one SERIALIZABLE transaction.
 */
@Injectable()
export class ReservationService {
  constructor(private readonly transactions: SerializableTransactionRunner) {}

  async reserve(
    command: CreditReservationCommand,
  ): Promise<CreditReservationOutcome> {
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
        if (!establishedEvent.outcomeOutboxEventId) {
          throw new CreditReservationInvariantError(
            'Reservation inbox outcome has no outbox event',
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
      const establishedReservation = await reservations.findOne({
        where: { errandId: command.payload.errandId },
        lock: { mode: 'pessimistic_write' },
      });

      if (establishedReservation) {
        if (
          establishedReservation.status === 'ACTIVE' &&
          establishedReservation.requesterUserId ===
            command.payload.requesterUserId &&
          establishedReservation.reservedAmount === command.payload.amount
        ) {
          const outboxEventId = await this.recordSuccess(
            manager,
            command,
            establishedReservation.latestTransactionId,
            payloadHash,
          );
          return {
            status: 'existing-reservation',
            eventId: command.eventId,
            reservationId: establishedReservation.id,
            transactionId: establishedReservation.latestTransactionId,
            outboxEventId,
          };
        }

        return this.reject(
          manager,
          command,
          payloadHash,
          'RESERVATION_CONFLICT',
        );
      }

      const accounts = manager.getRepository(CreditAccount);
      const account = await accounts.findOne({
        where: { userId: command.payload.requesterUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        return this.reject(manager, command, payloadHash, 'MISSING_BALANCE');
      }
      if (account.creditBalance < command.payload.amount) {
        return this.reject(
          manager,
          command,
          payloadHash,
          'INSUFFICIENT_CREDITS',
        );
      }

      const nextCreditBalance = account.creditBalance - command.payload.amount;
      const nextReservedBalance =
        account.reservedBalance + command.payload.amount;
      assertSafeBalances(nextCreditBalance, nextReservedBalance);
      account.creditBalance = nextCreditBalance;
      account.reservedBalance = nextReservedBalance;
      await accounts.save(account);

      const transactionId = randomUUID();
      const creditTransactions = manager.getRepository(CreditTransaction);
      const transaction = await creditTransactions.save(
        creditTransactions.create({
          id: transactionId,
          type: 'RESERVATION',
          amount: command.payload.amount,
          originBalanceType: 'CREDIT_BALANCE',
          destinationBalanceType: 'RESERVED_BALANCE',
          originUserId: command.payload.requesterUserId,
          destinationUserId: command.payload.requesterUserId,
          errandId: command.payload.errandId,
        }),
      );

      const reservation = await reservations.save(
        reservations.create({
          id: randomUUID(),
          errandId: command.payload.errandId,
          requesterUserId: command.payload.requesterUserId,
          reservedAmount: command.payload.amount,
          status: 'ACTIVE',
          latestTransactionId: transaction.id,
        }),
      );
      const outboxEventId = await this.recordSuccess(
        manager,
        command,
        transaction.id,
        payloadHash,
        transaction.createdAt,
      );

      return {
        status: 'created',
        eventId: command.eventId,
        reservationId: reservation.id,
        transactionId: transaction.id,
        outboxEventId,
      };
    });
  }

  private async reject(
    manager: EntityManager,
    command: CreditReservationCommand,
    payloadHash: string,
    reason: CreditReservationRejectionReason,
  ): Promise<CreditReservationOutcome> {
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
        outcomeTransactionId: transactionId,
        outcomeOutboxEventId: event.eventId,
      }),
    );
  }
}
