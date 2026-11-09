import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AnyDomainEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import { InboxEvent } from '../database/entities/index.js';

export type InboxIngestOutcome = 'processed' | 'duplicate' | 'conflict';

/** Stable JSON so a property-order change is not treated as different evidence. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function hashEventPayload(payload: object): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

/**
 * Transactional inbox: durable evidence of which validated events this service
 * has already accepted.
 *
 * `event_id` is the deduplication identity. A redelivery with the same
 * canonical payload is a duplicate; reuse of an event id with different
 * evidence is a conflict the transport dead-letters. The inbox knows nothing
 * about delivery — dispatchers decide that afterwards.
 */
@Injectable()
export class InboxService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async ingest(
    routingKey: string,
    event: AnyDomainEvent,
  ): Promise<InboxIngestOutcome> {
    const payloadHash = hashEventPayload(event.payload);

    return this.dataSource.transaction(async (manager) => {
      // An event id that has not been inserted yet cannot be locked by the
      // unique index, so serialize concurrent redeliveries explicitly.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [event.eventId],
      );

      const inbox = manager.getRepository(InboxEvent);
      const existing = await inbox.findOneBy({ eventId: event.eventId });

      // retries return without inserting a new inbox item.
      if (existing !== null) {
        return existing.routingKey === routingKey &&
          existing.payloadHash === payloadHash
          ? 'duplicate'
          : 'conflict';
      }

      await inbox.insert({
        eventId: event.eventId,
        eventType: event.eventType,
        routingKey,
        publisher: event.publisher,
        payloadHash,
      });

      return 'processed';
    });
  }
}
