import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { outboxEvents } from '../db/schema.js';
import type { Db } from '../lifecycle/transition.js';
import type { ClaimedOutboxEvent, OutboxPublication } from './outbox.types.js';

/**
 * Insert a notice inside the caller's transaction, so it commits or rolls back
 * with the state change. Not wired to transition() yet (needs contracts).
 */
export async function enqueueOutbox(tx: Db, event: OutboxPublication) {
  await tx.insert(outboxEvents).values(event);
}

/**
 * Short DB operations around broker I/O. Claims commit before publication; the
 * guarded updates stop an expired worker finalizing a row another has reclaimed.
 */
@Injectable()
export class OutboxStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  async claim(
    workerId: string,
    batchSize: number,
    leaseMilliseconds: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const { rows } = await this.db.execute<
      ClaimedOutboxEvent & Record<string, unknown>
    >(sql`
      WITH candidates AS (
        SELECT event_id
        FROM outbox_events
        WHERE published_at IS NULL
          AND next_attempt_at <= clock_timestamp()
          AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
        ORDER BY next_attempt_at ASC, created_at ASC, event_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE outbox_events AS event
      SET claimed_by = ${workerId},
          claimed_until = clock_timestamp() + (${leaseMilliseconds}::bigint * INTERVAL '1 millisecond'),
          attempt_count = event.attempt_count + 1
      FROM candidates
      WHERE event.event_id = candidates.event_id
      RETURNING event.event_id AS "eventId",
                event.event_type AS "eventType",
                event.routing_key AS "routingKey",
                event.envelope AS "envelope",
                event.created_at AS "createdAt",
                event.attempt_count AS "attemptCount",
                event.last_error AS "lastError"
    `);
    // Raw SQL returns timestamps as strings; the relay needs a Date.
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
  }

  async markPublished(eventId: string, workerId: string): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE outbox_events
      SET published_at = clock_timestamp(), claimed_by = NULL, claimed_until = NULL
      WHERE event_id = ${eventId} AND claimed_by = ${workerId} AND published_at IS NULL
      RETURNING event_id
    `);
    return rows.length === 1;
  }

  async markFailed(
    eventId: string,
    workerId: string,
    failure: string,
    retryDelayMilliseconds: number,
  ): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      UPDATE outbox_events
      SET last_error = ${failure},
          claimed_by = NULL,
          claimed_until = NULL,
          next_attempt_at = clock_timestamp() + (${retryDelayMilliseconds}::bigint * INTERVAL '1 millisecond')
      WHERE event_id = ${eventId} AND claimed_by = ${workerId} AND published_at IS NULL
      RETURNING event_id
    `);
    return rows.length === 1;
  }
}
