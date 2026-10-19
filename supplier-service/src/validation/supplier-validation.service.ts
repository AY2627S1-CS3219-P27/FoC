import { createHash, randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
  type SupplierValidationCompletedEvent,
  type SupplierValidationRequestedEvent,
  type SupplierValidationRequestedPayload,
  type SupplierValidationSnapshot,
} from '@foc/contracts';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { InboxEvent, OutboxEvent } from '../database/entities/index.js';
import { SupplierQueriesService } from '../suppliers/supplier-queries.service.js';
import type { SupplierDetail } from '../suppliers/supplier-view.js';

export type SupplierValidationResult =
  | { status: 'answered'; replyEventId: string; outcome: 'FOUND' | 'NOT_FOUND' }
  | { status: 'duplicate-event'; replyEventId: string }
  | { status: 'event-id-conflict'; eventId: string };

/** Thrown when this service builds a reply its own contract rejects. */
export class SupplierValidationInvariantError extends Error {
  constructor() {
    super(
      'Constructed SupplierValidationCompleted event violates its contract',
    );
    this.name = 'SupplierValidationInvariantError';
  }
}

/**
 * Hash only the validated payload, in a fixed field order, so the same
 * request is recognised whatever its JSON property order (as credit-service).
 */
export function hashValidationRequestPayload(
  payload: SupplierValidationRequestedPayload,
): string {
  const canonical = JSON.stringify({
    errandId: payload.errandId,
    supplierId: payload.supplierId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function snapshotOf(supplier: SupplierDetail): SupplierValidationSnapshot {
  return {
    status: supplier.status,
    version: supplier.version,
    name: supplier.name,
    displayName: supplier.displayName,
    building: {
      id: supplier.building.id,
      shortName: supplier.building.shortName,
      canonicalName: supplier.building.canonicalName,
    },
    floor: supplier.floor,
    locationDescription: supplier.locationDescription,
    coordinates: supplier.coordinates,
  };
}

/**
 * Answers Order Service's supplier-validation requests (F15.7). Each request
 * is answered exactly once: in one transaction, the request is recorded in
 * inbox_events together with its reply in outbox_events, which the outbox
 * relay then publishes (F15.7.2, F15.7.3). A redelivered request is
 * recognised and not answered again (F15.7.4).
 *
 * The reply reports facts only: FOUND with the supplier's current status,
 * version and details, or NOT_FOUND when it does not exist (F15.1, F15.2). A
 * failure to read the data store is never turned into NOT_FOUND: the error is
 * thrown, nothing is committed, and the transport retries (F15.7.5).
 */
@Injectable()
export class SupplierValidationService {
  private readonly replyRoutingKey: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly suppliers: SupplierQueriesService,
    private readonly contracts: AccountEventContractValidator,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.replyRoutingKey = config.get(
      'RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY',
      { infer: true },
    );
  }

  async process(
    event: SupplierValidationRequestedEvent,
  ): Promise<SupplierValidationResult> {
    return this.dataSource.transaction(async (manager) => {
      // An inbox row cannot lock an event id that is not inserted yet; this
      // transaction-scoped lock stops two deliveries of one request racing.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [event.eventId],
      );
      const payloadHash = hashValidationRequestPayload(event.payload);
      const answered = await manager.findOneBy(InboxEvent, {
        eventId: event.eventId,
      });
      if (answered) {
        return answered.eventType === event.eventType &&
          answered.payloadHash === payloadHash
          ? { status: 'duplicate-event', replyEventId: answered.replyEventId }
          : { status: 'event-id-conflict', eventId: event.eventId };
      }

      // Read on this transaction's connection: the reply then reflects the
      // same transaction that records it, and each message holds only one
      // pooled connection, so a full prefetch cannot exhaust the pool.
      const supplier = await this.lookUp(event.payload.supplierId, manager);
      const reply = this.reply(event, supplier);
      if (
        !this.contracts.validate(
          SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
          reply,
        ).valid
      ) {
        // A construction bug in this service, not a bad incoming request.
        throw new SupplierValidationInvariantError();
      }

      const outboxEvents = manager.getRepository(OutboxEvent);
      await outboxEvents.save(
        outboxEvents.create({
          eventId: reply.eventId,
          eventType: reply.eventType,
          routingKey: this.replyRoutingKey,
          envelope: reply,
          publishedAt: null,
          attemptCount: 0,
          lastError: null,
          claimedBy: null,
          claimedUntil: null,
        }),
      );
      // Saved last: its foreign key requires the reply it records.
      const inboxEvents = manager.getRepository(InboxEvent);
      await inboxEvents.save(
        inboxEvents.create({
          eventId: event.eventId,
          eventType: event.eventType,
          payloadHash,
          processedAt: new Date(),
          replyEventId: reply.eventId,
        }),
      );
      return {
        status: 'answered',
        replyEventId: reply.eventId,
        outcome: reply.payload.outcome,
      };
    });
  }

  /** The supplier, or null only when it does not exist; other errors throw. */
  private async lookUp(
    id: string,
    manager: EntityManager,
  ): Promise<SupplierDetail | null> {
    try {
      return await this.suppliers.get(id, manager);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private reply(
    request: SupplierValidationRequestedEvent,
    supplier: SupplierDetail | null,
  ): SupplierValidationCompletedEvent {
    const ids = {
      errandId: request.payload.errandId,
      supplierId: request.payload.supplierId,
    };
    return {
      eventId: randomUUID(),
      eventType: 'SupplierValidationCompleted',
      timestamp: new Date().toISOString(),
      publisher: 'supplier-service',
      payload: supplier
        ? { ...ids, outcome: 'FOUND', supplier: snapshotOf(supplier) }
        : { ...ids, outcome: 'NOT_FOUND' },
    };
  }
}
