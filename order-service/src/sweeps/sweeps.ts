import { Logger } from '@nestjs/common';
import { and, eq, gt, lte, sql, type SQL } from 'drizzle-orm';
import { errands } from '../db/schema.js';
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

// One pass of every sweep. Caller holds the advisory lock (sweep-lock.ts).
// Not built: the Pending-Supplier retry and hold window (no supplier contract yet).
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
    expired: await safe('expiry', () => cancelAll(
      db, 'Open', lte(errands.expiresAt, sql`now()`), 'ERRAND_EXPIRED')),
    pickupExceeded: await safe('pickup', () => cancelAll(
      db, 'Picked Up', lte(errands.pickedUpAt, ago(DAY_MS)), 'PICKUP_TIME_EXCEEDED')),
    creditTimedOut: await safe('reserving', () => cancelAll(
      db, 'Reserving-Credit', lte(errands.updatedAt, ago(cfg.reservingTimeoutMs)), 'CREDIT_TIMEOUT')),
    // A rejected transfer reverts to Delivered; leave it for an admin (ADR 0006).
    autoCompleted: await safe('auto-complete', () => move(
      db,
      and(
        eq(errands.status, 'Delivered'),
        lte(errands.deliveredAt, ago(DAY_MS)),
        sql`NOT EXISTS (SELECT 1 FROM errand_events e
              WHERE e.errand_id = ${errands.id}
                AND e.sequence_number = ${errands.lastSequenceNumber}
                AND e.type = 'CreditTransferFailed')`,
      ),
      { expected: 'Delivered', to: 'Transferring-Credit' },
    )),
    resent: await safe('credit-reply', () => resendOrAlert(db, cfg)),
  };
}
