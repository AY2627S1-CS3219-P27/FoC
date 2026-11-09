import { createHash, randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
  type SupplierValidationCompletedEvent,
  type SupplierValidationRequestedEvent,
  type SupplierValidationOutcome,
  type SupplierValidationRequestedPayload,
  type SupplierValidationSnapshot,
} from '@foc/contracts';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { BuildingsService } from '../buildings/buildings.service.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  type Building,
  InboxEvent,
  OutboxEvent,
  type Venue,
} from '../database/entities/index.js';
import { SupplierQueriesService } from '../suppliers/supplier-queries.service.js';
import type { SupplierDetail } from '../suppliers/supplier-view.js';
import { VenuesService } from '../venues/venues.service.js';

export type SupplierValidationResult =
  | {
      status: 'answered';
      replyEventId: string;
      outcome: SupplierValidationOutcome;
    }
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
    deliveryBuildingId: payload.deliveryBuildingId,
    // Dropped by JSON.stringify when absent, so old requests keep their hash.
    deliveryVenueId: payload.deliveryVenueId,
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
 * version and details plus the delivery building (and venue, when one was
 * asked for), NOT_FOUND when the supplier does not exist, BUILDING_NOT_FOUND
 * when only the building is unknown or retired, or VENUE_NOT_FOUND when only
 * the venue is unknown, retired or in another building (F15.1, F15.2). A
 * failure to read the data store is never turned into NOT_FOUND: the error is
 * thrown, nothing is committed, and the transport retries (F15.7.5).
 */
@Injectable()
export class SupplierValidationService {
  private readonly replyRoutingKey: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly suppliers: SupplierQueriesService,
    private readonly buildings: BuildingsService,
    private readonly venues: VenuesService,
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
      // A missing supplier wins: the building is only checked for a supplier
      // that exists (Order Service ADR 0011).
      const building = supplier
        ? await this.buildings.findInUseById(
            event.payload.deliveryBuildingId,
            manager,
          )
        : null;
      // Likewise a missing building wins over a missing venue.
      const { deliveryVenueId } = event.payload;
      const venue =
        building && deliveryVenueId !== undefined
          ? await this.venues.findInUse(building.id, deliveryVenueId, manager)
          : null;
      const reply = this.reply(event, supplier, building, venue);
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
    building: Building | null,
    venue: Venue | null,
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
      payload: this.outcome(
        ids,
        supplier,
        building,
        venue,
        request.payload.deliveryVenueId !== undefined,
      ),
    };
  }

  /**
   * NOT_FOUND (no supplier) wins over BUILDING_NOT_FOUND (no building), which
   * wins over VENUE_NOT_FOUND (a venue was asked for but is not in use there).
   */
  private outcome(
    ids: { errandId: string; supplierId: string },
    supplier: SupplierDetail | null,
    building: Building | null,
    venue: Venue | null,
    venueRequested: boolean,
  ): SupplierValidationCompletedEvent['payload'] {
    if (!supplier) {
      return { ...ids, outcome: 'NOT_FOUND' };
    }
    if (!building) {
      return { ...ids, outcome: 'BUILDING_NOT_FOUND' };
    }
    if (venueRequested && !venue) {
      return { ...ids, outcome: 'VENUE_NOT_FOUND' };
    }
    return {
      ...ids,
      outcome: 'FOUND',
      supplier: snapshotOf(supplier),
      deliveryBuilding: {
        id: building.id,
        shortName: building.shortName,
        canonicalName: building.canonicalName,
        coordinates: {
          latitude: building.latitude,
          longitude: building.longitude,
        },
      },
      ...(venue && {
        deliveryVenue: {
          id: venue.id,
          code: venue.code,
          name: venue.name,
          floor: venue.floor,
          coordinates: { latitude: venue.latitude, longitude: venue.longitude },
        },
      }),
    };
  }
}
