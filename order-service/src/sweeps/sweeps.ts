import { Logger } from '@nestjs/common';
import { and, eq, gt, lte, sql, type SQL } from 'drizzle-orm';
import { errands, outboxEvents } from '../db/schema.js';
import { enqueueSupplierRequest, supplierRequestId } from '../lifecycle/notice.js';
import { backoffDelay } from '../retry/backoff.js';
import type { Status } from '../lifecycle/status.js';
import {
  SYSTEM,
  transition,
  type Db,
  type TransitionInput,
} from '../lifecycle/transition.js';

export interface SweepConfig {
  reservingTimeoutMs: number; // Reserving-Credit -> Cancelled (CREDIT_TIMEOUT)
  replyTimeoutMs: number; // in-flight credit status: re-send once per window
  resendMax: number; // windows of re-sending before the admin alert
  keyTtlMs: number; // idempotency keys older than this are deleted (ADR 0005)
  supplierRetryBaseMs: number;
  supplierRetryMaxMs: number;
  supplierHoldMs: number;
  random?: () => number; // jitter source; tests pin it
}

const DAY_MS = 24 * 60 * 60 * 1000; // pickup and auto-complete windows (ADR 0007, F6.5)
const BATCH = 100; // per sweep per tick; the rest wait for the next one
const logger = new Logger('Sweeps');

// Compared in SQL against the database clock. Known gap: picked_up_at and
// delivered_at are stamped by the app (the caller's `set`), so app/database
// clock skew shifts the 24h pickup and auto-complete timers by that much.
// Fix if it matters: stamp them with now() in the transition UPDATE.
const ago = (ms: number) => sql`now() - (${ms}::bigint * interval '1 millisecond')`;

const ids = async (db: Db, where: SQL | undefined) =>
  (await db.select({ id: errands.id }).from(errands).where(where).limit(BATCH)).map(
    (r) => r.id,
  );

// Every sweep write is a SYSTEM transition(). A STATE_MISMATCH means the
// errand moved on since the scan (a reply, a cancel, another instance): fine.
async function move(
  db: Db,
  where: SQL | undefined,
  step: Omit<TransitionInput, 'errandId' | 'actor'>,
): Promise<number> {
  let moved = 0;
  for (const errandId of await ids(db, where)) {
    try {
      const res = await transition(db, { ...step, errandId, actor: SYSTEM });
      if (res.ok) moved++;
      else if (res.reason !== 'STATE_MISMATCH') {
        logger.warn(`${step.expected} -> ${step.to} on ${errandId}: ${res.reason}`);
      }
    } catch (e) {
      logger.error(`${step.expected} -> ${step.to} on ${errandId}: ${String(e)}`);
    }
  }
  return moved;
}

const cancelAll = (db: Db, from: Status, where: SQL, reason: string) =>
  move(db, and(eq(errands.status, from), where), {
    expected: from,
    to: 'Cancelled',
    set: { cancellationReason: reason },
  });

// The routing key of the notice each in-flight status is waiting on a reply to.
const AWAITING_REPLY = {
  'Transferring-Credit': 'order.errand-completed.v1',
  'Adjusting-Credit': 'credit.reservation-adjustment.v1',
} as const;

// A timeout never reverts (ADR 0006). Re-queue the original outbox row, same
// eventId so credit dedups, once per window (published_at moves on each send).
// ponytail: counts windows from updated_at instead of storing an attempt
// count; the alert repeats every tick until an admin moves the errand.
async function resendOrAlert(db: Db, cfg: SweepConfig): Promise<number> {
  let resent = 0;
  const stuckAfter = cfg.replyTimeoutMs * (cfg.resendMax + 1);
  for (const [status, routingKey] of Object.entries(AWAITING_REPLY)) {
    const s = status as keyof typeof AWAITING_REPLY;
    const stuck = await ids(
      db,
      and(eq(errands.status, s), lte(errands.updatedAt, ago(stuckAfter))),
    );
    for (const id of stuck) {
      logger.error(
        `ADMIN ALERT: errand ${id} still ${status} after ${cfg.resendMax} re-sends; credit-service is not replying`,
      );
    }
    const waiting = await ids(
      db,
      and(
        eq(errands.status, s),
        lte(errands.updatedAt, ago(cfg.replyTimeoutMs)),
        gt(errands.updatedAt, ago(stuckAfter)),
      ),
    );
    for (const id of waiting) {
      const res = await db.execute(sql`
        UPDATE outbox_events
        SET published_at = NULL, claimed_by = NULL, claimed_until = NULL,
            next_attempt_at = clock_timestamp()
        WHERE event_id = (
            SELECT event_id FROM outbox_events
            WHERE routing_key = ${routingKey} AND envelope->'payload'->>'errandId' = ${id}
            ORDER BY created_at DESC LIMIT 1)
          AND published_at IS NOT NULL
          AND published_at <= ${ago(cfg.replyTimeoutMs)}`);
      resent += res.rowCount ?? 0;
    }
  }
  return resent;
}

const after = (ms: number) => sql`now() + (${ms}::bigint * interval '1 millisecond')`;

// No retry row yet = due at created_at + base.
async function resendSupplierRequests(db: Db, cfg: SweepConfig): Promise<number> {
  const due = await db.execute<{
    id: string;
    supplier_id: string;
    delivery_building_id: string;
    attempts: number;
  }>(sql`
    SELECT e.id, e.supplier_id, e.delivery_building_id, coalesce(r.attempts, 0) AS attempts
    FROM errands e LEFT JOIN supplier_validation_retries r ON r.errand_id = e.id
    WHERE e.status = 'Pending-Supplier'
      AND e.created_at > ${ago(cfg.supplierHoldMs)}
      AND coalesce(r.next_retry_at, e.created_at + (${cfg.supplierRetryBaseMs}::bigint * interval '1 millisecond')) <= now()
    LIMIT ${BATCH}`);

  let resent = 0;
  for (const { id, supplier_id, delivery_building_id, attempts } of due.rows) {
    const sent = Number(attempts);
    const wait = backoffDelay(sent + 2, {
      baseMs: cfg.supplierRetryBaseMs,
      maxMs: cfg.supplierRetryMaxMs,
      random: cfg.random,
    });
    await db.transaction(async (tx) => {
      const [last] = await tx
        .select({ publishedAt: outboxEvents.publishedAt })
        .from(outboxEvents)
        .where(eq(outboxEvents.eventId, supplierRequestId(id, sent)));
      // Still unpublished: the relay has not sent the last one, so a new one would only queue behind it.
      const send = !last || last.publishedAt !== null;
      if (send) {
        await enqueueSupplierRequest(tx, id, supplier_id, delivery_building_id, sent + 1);
        resent++;
      }
      await tx.execute(sql`
        INSERT INTO supplier_validation_retries (errand_id, attempts, next_retry_at)
        VALUES (${id}, ${send ? sent + 1 : sent}, ${after(wait)})
        ON CONFLICT (errand_id) DO UPDATE
        SET attempts = EXCLUDED.attempts, next_retry_at = EXCLUDED.next_retry_at`);
    });
  }

  await db.execute(sql`
    DELETE FROM supplier_validation_retries
    WHERE errand_id IN (
      SELECT r.errand_id FROM supplier_validation_retries r
      JOIN errands e ON e.id = r.errand_id
      WHERE e.status <> 'Pending-Supplier'
      LIMIT ${BATCH})`);
  return resent;
}

// Retention (ADR 0005). A duplicate arriving after its key is gone still meets
// the status guard, so it fails with STATE_MISMATCH or is caught as a keyless
// repeat; the window only needs to outlast broker and client retries.
async function pruneKeys(db: Db, cfg: SweepConfig): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM idempotency_keys
    WHERE (errand_id, key) IN (
      SELECT errand_id, key FROM idempotency_keys
      WHERE created_at <= ${ago(cfg.keyTtlMs)}
      ORDER BY created_at LIMIT ${BATCH})`);
  return res.rowCount ?? 0;
}

// One pass of every sweep. Caller holds the advisory lock (sweep-lock.ts).
export async function runSweeps(db: Db, cfg: SweepConfig) {
  // One failing sweep must not skip the rest of the tick.
  const safe = async (name: string, run: () => Promise<number>) => {
    try {
      return await run();
    } catch (e) {
      logger.error(`${name} sweep failed: ${String(e)}`);
      return 0;
    }
  };
  return {
    // Hold window first, so a resend never goes to an errand about to time out.
    supplierTimedOut: await safe('supplier hold', () => cancelAll(
      db, 'Pending-Supplier', lte(errands.createdAt, ago(cfg.supplierHoldMs)), 'SUPPLIER_VALIDATION_TIMEOUT')),
    supplierResent: await safe('supplier resend', () => resendSupplierRequests(db, cfg)),
    expired: await safe('expiry', () => cancelAll(
      db, 'Open', lte(errands.expiresAt, sql`now()`), 'ERRAND_EXPIRED')),
    pickupExceeded: await safe('pickup', () => cancelAll(
      db, 'Picked Up', lte(errands.pickedUpAt, ago(DAY_MS)), 'PICKUP_TIME_EXCEEDED')),
    creditTimedOut: await safe('reserving', () => cancelAll(
      db, 'Reserving-Credit', lte(errands.updatedAt, ago(cfg.reservingTimeoutMs)), 'CREDIT_TIMEOUT')),
    autoCompleted: await safe('auto-complete', () => move(
      db,
      and(eq(errands.status, 'Delivered'), lte(errands.deliveredAt, ago(DAY_MS))),
      { expected: 'Delivered', to: 'Transferring-Credit' },
    )),
    resent: await safe('credit-reply', () => resendOrAlert(db, cfg)),
    keysPruned: await safe('key retention', () => pruneKeys(db, cfg)),
  };
}
