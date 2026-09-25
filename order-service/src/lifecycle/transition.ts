import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { errandEvents, errands, idempotencyKeys } from '../db/schema.js';
import { EDGES, type Col, type Edge } from './edges.js';
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
  const edge = EDGES[i.expected]?.[i.to];
  // `set` must carry exactly the columns this edge owns. Checked before the
  // transaction: a caller bug is not an outcome worth storing under a key.
  if (edge) {
    const given = Object.entries(i.set ?? {})
      .filter(([, v]) => v != null)
      .map(([k]) => k);
    if (
      given.length !== edge.sets.length ||
      !edge.sets.every((c) => given.includes(c))
    ) {
      return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
    }
  }

  const actor = i.actorId ?? null; // undefined and null are the same system actor
  const fingerprint = `${i.expected}|${i.to}|${actor ?? ''}`;

  return db.transaction(async (tx): Promise<TransitionResult> => {
    // Claim the key. A concurrent claimant blocks here until we commit.
    if (i.idempotencyKey) {
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({ errandId: i.errandId, key: i.idempotencyKey, fingerprint })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (!claimed) {
        const [prior] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.errandId, i.errandId),
              eq(idempotencyKeys.key, i.idempotencyKey),
            ),
          );
        if (prior.fingerprint !== fingerprint) {
          return { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' };
        }
        const out = prior.outcome as TransitionResult;
        return out.ok ? { ...out, replayed: true } : out;
      }
    }

    const result = edge ? await apply(tx, i, edge, actor) : ILLEGAL;

    if (i.idempotencyKey) {
      await tx
        .update(idempotencyKeys)
        .set({ outcome: result })
        .where(
          and(
            eq(idempotencyKeys.errandId, i.errandId),
            eq(idempotencyKeys.key, i.idempotencyKey),
          ),
        );
    }
    return result;
  });
}

const ILLEGAL: TransitionResult = { ok: false, reason: 'ILLEGAL_TRANSITION' };

async function apply(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
): Promise<TransitionResult> {
  const cleared = Object.fromEntries(edge.clears.map((c) => [c, null]));
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

  if (row) {
    await tx.insert(errandEvents).values({
      errandId: i.errandId,
      sequenceNumber: row.seq,
      type: edge.type,
      fromStatus: i.expected,
      toStatus: i.to,
      payload: i.payload ?? {},
      actorId: actor,
    });
    return { ok: true, sequenceNumber: row.seq };
  }

  // Lost the race (or wrong expectation): nothing was written.
  const [cur] = await tx
    .select({ status: errands.status })
    .from(errands)
    .where(eq(errands.id, i.errandId));
  if (!cur) return { ok: false, reason: 'NOT_FOUND' };

  // Keyless repeat (#349): the errand's latest event is this very edge by this
  // caller, so the request already happened.
  const [last] = await tx
    .select()
    .from(errandEvents)
    .where(eq(errandEvents.errandId, i.errandId))
    .orderBy(desc(errandEvents.sequenceNumber))
    .limit(1);
  if (
    last &&
    last.fromStatus === i.expected &&
    last.toStatus === i.to &&
    last.actorId === actor
  ) {
    return { ok: true, sequenceNumber: last.sequenceNumber, replayed: true };
  }
  return { ok: false, reason: 'STATE_MISMATCH', currentStatus: cur.status };
}
