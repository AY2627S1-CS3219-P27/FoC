import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { errandEvents, errands } from '../db/schema.js';
import { canTransition, type Status } from './status.js';

export type Db = NodePgDatabase<any>;

export interface TransitionInput {
  errandId: string;
  expected: Status;
  to: Status;
  type: string;
  actorId?: string | null; // null = system actor (sweeps)
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  // Projection columns written in the same UPDATE (e.g. courierId on accept).
  set?: Partial<
    Pick<
      typeof errands.$inferInsert,
      'courierId' | 'pickedUpAt' | 'deliveredAt' | 'cancellationReason'
    >
  >;
}

export type TransitionResult =
  | { ok: true; sequenceNumber: number; replayed?: true }
  | {
      ok: false;
      reason: 'ILLEGAL_TRANSITION' | 'NOT_FOUND' | 'IDEMPOTENCY_KEY_REUSED';
    }
  | { ok: false; reason: 'STATE_MISMATCH'; currentStatus: Status };

// The one write path (ARCHITECTURE.md §3, ADR 0005).
export function transition(
  db: Db,
  i: TransitionInput,
): Promise<TransitionResult> {
  if (!canTransition(i.expected, i.to)) {
    return Promise.resolve({ ok: false, reason: 'ILLEGAL_TRANSITION' });
  }
  return db.transaction(async (tx): Promise<TransitionResult> => {
    // Only requests that produced an event are replayed; rejected ones are re-evaluated (ADR 0005).
    const replay = async (): Promise<TransitionResult | undefined> => {
      if (!i.idempotencyKey) return;
      const [e] = await tx
        .select({ seq: errandEvents.sequenceNumber, to: errandEvents.toStatus })
        .from(errandEvents)
        .where(
          and(
            eq(errandEvents.errandId, i.errandId),
            eq(errandEvents.idempotencyKey, i.idempotencyKey),
          ),
        );
      if (!e) return;
      // Same key, different transition: a client bug, not a replay.
      return e.to === i.to
        ? { ok: true, sequenceNumber: e.seq, replayed: true }
        : { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' };
    };

    const seen = await replay();
    if (seen) return seen;

    const [row] = await tx
      .update(errands)
      .set({
        ...i.set,
        status: i.to,
        lastSequenceNumber: sql`${errands.lastSequenceNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(errands.id, i.errandId), eq(errands.status, i.expected)))
      .returning({ seq: errands.lastSequenceNumber });

    if (!row) {
      // Lost the race (or wrong expectation): nothing was written. A same-key
      // request that won the race has committed by now, so replay it.
      const won = await replay();
      if (won) return won;
      const [cur] = await tx
        .select({ status: errands.status })
        .from(errands)
        .where(eq(errands.id, i.errandId));
      return cur
        ? { ok: false, reason: 'STATE_MISMATCH', currentStatus: cur.status }
        : { ok: false, reason: 'NOT_FOUND' };
    }

    await tx.insert(errandEvents).values({
      errandId: i.errandId,
      sequenceNumber: row.seq,
      type: i.type,
      fromStatus: i.expected,
      toStatus: i.to,
      payload: i.payload ?? {},
      actorId: i.actorId ?? null,
      idempotencyKey: i.idempotencyKey,
    });
    return { ok: true, sequenceNumber: row.seq };
  });
}
