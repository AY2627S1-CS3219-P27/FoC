import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { errandEvents, errands } from '../db/schema.js';
import { EDGES, type Col } from './edges.js';
import type { Status } from './status.js';

export type Db = NodePgDatabase<any>;

export interface TransitionInput {
  errandId: string;
  expected: Status;
  to: Status;
  actorId?: string | null; // null = system actor (sweeps)
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  // Values for the columns the edge sets (e.g. courierId on accept).
  set?: Partial<Pick<typeof errands.$inferInsert, Col>>;
}

export type TransitionResult =
  | { ok: true; sequenceNumber: number; replayed?: true }
  | {
      ok: false;
      reason:
        | 'ILLEGAL_TRANSITION'
        | 'INVALID_FIELDS'
        | 'NOT_FOUND'
        | 'IDEMPOTENCY_KEY_REUSED';
    }
  | { ok: false; reason: 'STATE_MISMATCH'; currentStatus: Status };


export function transition(
  db: Db,
  i: TransitionInput,
): Promise<TransitionResult> {
  //validating that calls for each transition will have the right payload
  const edge = EDGES[i.expected]?.[i.to];
  if (!edge) {
    return Promise.resolve({ ok: false, reason: 'ILLEGAL_TRANSITION' });
  }
  // `set` must carry exactly the columns this edge owns.
  const given = Object.entries(i.set ?? {})
    .filter(([, v]) => v != null)
    .map(([k]) => k);
  if (
    given.length !== edge.sets.length ||
    !edge.sets.every((c) => given.includes(c))
  ) {
    return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
  }

  const cleared = Object.fromEntries(edge.clears.map((c) => [c, null]));
  return db.transaction(async (tx): Promise<TransitionResult> => {
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
        ...cleared,
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
      type: edge.type,
      fromStatus: i.expected,
      toStatus: i.to,
      payload: i.payload ?? {},
      actorId: i.actorId ?? null,
      idempotencyKey: i.idempotencyKey,
    });
    return { ok: true, sequenceNumber: row.seq };
  });
}
