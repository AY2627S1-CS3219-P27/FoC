import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** A key is remembered for 24 hours (F14.2.1). */
export const IDEMPOTENCY_TTL_HOURS = 24;
/** A request still running after this long is taken to have died. */
export const IDEMPOTENCY_STALE_CLAIM_SECONDS = 60;

/** What a successful request answered, to replay for a repeat (F14.2.1). */
export interface StoredOutcome {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export type IdempotencyBegin =
  /** A fresh key: run the request, then complete or release the claim. */
  | { kind: 'run'; claimId: string }
  /** The same request succeeded before: answer with its stored outcome. */
  | { kind: 'replay'; outcome: StoredOutcome }
  /** The key was used for a different request (F14.2.2). */
  | { kind: 'mismatch' }
  /** The same request is still running. */
  | { kind: 'in-progress' };

interface KeyRow {
  claim_id: string;
  fingerprint: string;
  status_code: number | null;
  headers: Record<string, string> | null;
  body: unknown;
  completed: boolean;
  expired: boolean;
  stale: boolean;
}

/**
 * Idempotency keys for requests that create a record (F14.2). A request
 * claims its key before it runs; only a success is stored, so a failed
 * attempt releases the key and can be corrected and retried. Each step is one
 * short statement, so no database connection is held while the request runs.
 * If the process dies mid-request, its claim goes stale after a minute and
 * the retry runs again; the unique constraints on suppliers, requests,
 * categories, brands and buildings still refuse a double create.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly dataSource: DataSource) {}

  async begin(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyBegin> {
    // A few rounds: an expired or abandoned claim is removed and claimed again,
    // and another request may take the key in between.
    for (let round = 0; round < 5; round += 1) {
      const claimId = randomUUID();
      const inserted: unknown[] = await this.dataSource.query(
        `INSERT INTO idempotency_keys (user_id, key, claim_id, fingerprint)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO NOTHING
         RETURNING claim_id`,
        [userId, key, claimId, fingerprint],
      );
      if (inserted.length > 0) {
        return { kind: 'run', claimId };
      }

      const [row] = await this.dataSource.query<KeyRow[]>(
        `SELECT claim_id, fingerprint, status_code, headers, body,
                completed_at IS NOT NULL AS completed,
                created_at < now() - make_interval(hours => $3) AS expired,
                (completed_at IS NULL
                  AND created_at < now() - make_interval(secs => $4)) AS stale
         FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
        [userId, key, IDEMPOTENCY_TTL_HOURS, IDEMPOTENCY_STALE_CLAIM_SECONDS],
      );
      if (row === undefined) {
        continue; // released in between: claim it
      }
      if (row.expired || row.stale) {
        // Only this exact claim is removed, never a fresher one.
        await this.dataSource.query(
          `DELETE FROM idempotency_keys
           WHERE user_id = $1 AND key = $2 AND claim_id = $3`,
          [userId, key, row.claim_id],
        );
        continue;
      }
      if (row.fingerprint !== fingerprint) {
        return { kind: 'mismatch' };
      }
      if (row.completed) {
        return {
          kind: 'replay',
          outcome: {
            statusCode: row.status_code!,
            headers: row.headers ?? {},
            body: row.body,
          },
        };
      }
      return { kind: 'in-progress' };
    }
    return { kind: 'in-progress' };
  }

  /** Stores the outcome of the request that made the claim. */
  async complete(
    userId: string,
    key: string,
    claimId: string,
    outcome: StoredOutcome,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE idempotency_keys
       SET status_code = $4, headers = $5::jsonb, body = $6::jsonb,
           completed_at = now()
       WHERE user_id = $1 AND key = $2 AND claim_id = $3`,
      [
        userId,
        key,
        claimId,
        outcome.statusCode,
        JSON.stringify(outcome.headers),
        JSON.stringify(outcome.body ?? null),
      ],
    );
  }

  /** Frees the key after a failure, so a corrected retry can use it. */
  async release(userId: string, key: string, claimId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM idempotency_keys
       WHERE user_id = $1 AND key = $2 AND claim_id = $3
         AND completed_at IS NULL`,
      [userId, key, claimId],
    );
  }

  /** Removes keys older than 24 hours; returns how many (F14.2.1). */
  async purgeExpired(): Promise<number> {
    const [row] = await this.dataSource.query<{ n: number }[]>(
      `WITH purged AS (
         DELETE FROM idempotency_keys
         WHERE created_at < now() - make_interval(hours => $1)
         RETURNING 1
       ) SELECT count(*)::int AS n FROM purged`,
      [IDEMPOTENCY_TTL_HOURS],
    );
    return row?.n ?? 0;
  }
}
