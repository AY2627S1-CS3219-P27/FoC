import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ClaimedOutboxEvent } from './outbox-publication.types.js';

interface ClaimedOutboxRow {
  eventId: string;
  eventType: string;
  routingKey: string;
  envelope: Record<string, unknown>;
  createdAt: Date;
  attemptCount: number;
  lastError: string | null;
}

/**
 * Owns the short database operations around broker I/O. Claims commit before
 * publication, while guarded completion updates prevent an expired worker
 * from finalizing a row that another instance has reclaimed.
 */
@Injectable()
export class OutboxStore {
  constructor(private readonly dataSource: DataSource) {}

  async claim(
    workerId: string,
    batchSize: number,
    leaseMilliseconds: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const [rows] = await this.dataSource.query<[ClaimedOutboxRow[], number]>(
      `
        WITH candidates AS (
          SELECT event_id
          FROM outbox_events
          WHERE published_at IS NULL
            AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
          ORDER BY created_at ASC, event_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE outbox_events AS event
        SET claimed_by = $2,
            claimed_until = clock_timestamp() + ($3::bigint * INTERVAL '1 millisecond'),
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
      `,
      [batchSize, workerId, leaseMilliseconds],
    );

    return rows;
  }

  async markPublished(eventId: string, workerId: string): Promise<boolean> {
    const [rows] = await this.dataSource.query<
      [Array<{ eventId: string }>, number]
    >(
      `
        UPDATE outbox_events
        SET published_at = clock_timestamp(),
            claimed_by = NULL,
            claimed_until = NULL
        WHERE event_id = $1
          AND claimed_by = $2
          AND published_at IS NULL
        RETURNING event_id AS "eventId"
      `,
      [eventId, workerId],
    );

    return rows.length === 1;
  }

  async markFailed(
    eventId: string,
    workerId: string,
    failure: string,
  ): Promise<boolean> {
    const [rows] = await this.dataSource.query<
      [Array<{ eventId: string }>, number]
    >(
      `
        UPDATE outbox_events
        SET last_error = $3,
            claimed_by = NULL,
            claimed_until = NULL
        WHERE event_id = $1
          AND claimed_by = $2
          AND published_at IS NULL
        RETURNING event_id AS "eventId"
      `,
      [eventId, workerId, failure],
    );

    return rows.length === 1;
  }
}
