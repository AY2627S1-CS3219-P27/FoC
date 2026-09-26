import { createHash, randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type CreditAccountInitialisedEvent,
  type UserRegisteredEvent,
  type UserRegisteredPayload,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountAllocationService } from '../account/account-allocation.service.js';
import type { EnvironmentVariables } from '../config/environment.js';
import { InboxEvent, OutboxEvent } from '../database/entities/index.js';
import { SerializableTransactionRunner } from '../database/serializable-transaction.runner.js';

export type AccountInitializationOutcome =
  | {
      status: 'created';
      userId: string;
      allocationId: string;
      outboxEventId: string;
    }
  | {
      status: 'existing-allocation' | 'duplicate-event';
      userId: string;
      allocationId: string;
    }
  | { status: 'event-id-conflict'; eventId: string };

export class AccountInitializationInvariantError extends Error {
  constructor() {
    super('Constructed CreditAccountInitialised event violates its contract');
    this.name = 'AccountInitializationInvariantError';
  }
}

/**
 * Hash only the validated business payload, in a fixed field order. This makes
 * semantically identical JSON independent of its original property order while
 * retaining no email address or display name in the inbox.
 */
export function hashUserRegisteredPayload(
  payload: UserRegisteredPayload,
): string {
  const canonicalPayload = JSON.stringify({
    userId: payload.userId,
    email: payload.email,
    displayName: payload.displayName,
  });

  return createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Establishes the durable result of UserRegistered in one SERIALIZABLE
 * transaction. The inbox row, account state, allocation, and optional outbox
 * event therefore either all commit or all roll back.
 */
@Injectable()
export class AccountInitializationService {
  private readonly outgoingRoutingKey: string;

  constructor(
    private readonly transactions: SerializableTransactionRunner,
    private readonly allocations: AccountAllocationService,
    private readonly contracts: AccountEventContractValidator,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.outgoingRoutingKey = config.get(
      'RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY',
      { infer: true },
    );
  }

  async process(
    event: UserRegisteredEvent,
  ): Promise<AccountInitializationOutcome> {
    return this.transactions.run(async (manager) => {
      // An inbox row cannot lock an event ID that has not been inserted yet.
      // This transaction-scoped lock closes that race without surviving commit.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [event.eventId],
      );

      const payloadHash = hashUserRegisteredPayload(event.payload);
      const inboxEvents = manager.getRepository(InboxEvent);
      const establishedEvent = await inboxEvents.findOneBy({
        eventId: event.eventId,
      });

      if (establishedEvent) {
        if (
          establishedEvent.eventType === event.eventType &&
          establishedEvent.payloadHash === payloadHash
        ) {
          return {
            status: 'duplicate-event',
            userId: event.payload.userId,
            allocationId: establishedEvent.outcomeAllocationId,
          };
        }

        return { status: 'event-id-conflict', eventId: event.eventId };
      }

      const allocation = await this.allocations.allocate(
        manager,
        event.payload.userId,
      );
      let outboxEventId: string | undefined;

      if (allocation.created) {
        outboxEventId = randomUUID();
        const outgoingEvent: CreditAccountInitialisedEvent = {
          eventId: outboxEventId,
          eventType: 'CreditAccountInitialised',
          timestamp: allocation.allocatedAt.toISOString(),
          publisher: 'credit-service',
          payload: {
            userId: allocation.userId,
            creditAmountAllocated: allocation.creditAmountAllocated,
            creditAllocationId: allocation.allocationId,
          },
        };
        const validation =
          this.contracts.validateCreditAccountInitialised(outgoingEvent);
        if (!validation.valid) {
          // This is an internal construction bug, not an invalid incoming event.
          throw new AccountInitializationInvariantError();
        }

        const outboxEvents = manager.getRepository(OutboxEvent);
        await outboxEvents.save(
          outboxEvents.create({
            eventId: outboxEventId,
            eventType: outgoingEvent.eventType,
            routingKey: this.outgoingRoutingKey,
            envelope: outgoingEvent,
            publishedAt: null,
            attemptCount: 0,
            lastError: null,
            claimedBy: null,
            claimedUntil: null,
          }),
        );
      }

      // Insert last because the inbox's non-null foreign key records the
      // allocation that is authoritative for this registration outcome.
      await inboxEvents.save(
        inboxEvents.create({
          eventId: event.eventId,
          eventType: event.eventType,
          payloadHash,
          processedAt: new Date(),
          outcomeAllocationId: allocation.allocationId,
        }),
      );

      if (allocation.created) {
        return {
          status: 'created',
          userId: allocation.userId,
          allocationId: allocation.allocationId,
          outboxEventId: outboxEventId!,
        };
      }

      return {
        status: 'existing-allocation',
        userId: allocation.userId,
        allocationId: allocation.allocationId,
      };
    });
  }
}
