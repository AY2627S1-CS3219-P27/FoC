import { and, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { COURIER_LOCK_INDEX, errandEvents, errands, idempotencyKeys } from '../db/schema.js';
import { EDGES, findEdge, type Col, type Edge, type UserRole } from './edges.js';
import type { Status } from './status.js';

export type Db = NodePgDatabase<any>;

// Who is acting. Required and explicit: a missing or failed-auth user must
// never fall through to the system, which may take system-only edges.
export type Actor = { kind: 'user'; id: string } | { kind: 'system' };
export const SYSTEM: Actor = { kind: 'system' };
export const user = (id: string): Actor => ({ kind: 'user', id });

// Stored actor_id: null = system.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorIdOf = (a: Actor | undefined): string | null | undefined =>
  a?.kind === 'system' ? null : a?.kind === 'user' && UUID.test(a.id) ? a.id.toLowerCase() : undefined;

export interface TransitionInput {
  errandId: string;
  expected: Status;
  to: Status;
  // Event type; only for a pair with several exits (Adjusting-Credit -> Open).
  type?: string;
  actor: Actor;
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
        | 'IDEMPOTENCY_KEY_REUSED'
        | 'FORBIDDEN' // actor may not take this edge on this errand
        | 'COURIER_BUSY' // courier already holds an active errand
        | 'EXPIRED'; // accept after expires_at
    }
  | { ok: false; reason: 'STATE_MISMATCH'; currentStatus: Status };

export function transition(
  db: Db,
  i: TransitionInput,
): Promise<TransitionResult> {
  // undefined = malformed actor (missing, unknown kind, bad id): a caller bug.
  const actor = actorIdOf(i.actor);
  if (actor === undefined) {
    return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
  }
  const edge = findEdge(i.expected, i.to, i.type);
  // A pair with several exits needs a known `type`; that is a caller bug, not an illegal edge.
  if (!edge && Array.isArray(EDGES[i.expected]?.[i.to])) {
    return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
  }
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
    // The courier is the actor who accepts, never a name passed in by the caller.
    if (edge.sets.includes('courierId') && actor && i.set?.courierId?.toLowerCase() !== actor) {
      return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
    }
    const reason = i.set?.cancellationReason;
    if (edge.reasons && !edge.reasons.some((r) => r === reason)) {
      return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
    }
  }

  const fingerprint = `${i.expected}|${i.to}|${actor ?? ''}${i.type ? `|${i.type}` : ''}`;

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

// Row-level actor check for a user actor (race-safe: part of the UPDATE).
const roleSql: Record<UserRole, (a: string) => SQL> = {
  requester: (a) => eq(errands.requesterId, a),
  courier: (a) => eq(errands.courierId, a),
  other: (a) => ne(errands.requesterId, a),
};
// A null actor is the system and matches no row predicate: it passes only on
// an edge that lists 'system'. A user passes if any of their roles holds.
const actorOk = (edge: Edge, actor: string | null): SQL | undefined => {
  const users = edge.who.filter((r): r is UserRole => r !== 'system');
  if (!actor) return edge.who.includes('system') ? undefined : sql`false`;
  return users.length ? or(...users.map((r) => roleSql[r](actor))) : sql`false`;
};

// Unique violation on the one-active-errand-per-courier index (L5), by name.
const isCourierBusy = (e: unknown) => {
  const c = ((e as { cause?: object })?.cause ?? e) as { code?: string; constraint?: string };
  return c.code === '23505' && c.constraint === COURIER_LOCK_INDEX;
};

const ILLEGAL: TransitionResult = { ok: false, reason: 'ILLEGAL_TRANSITION' };

async function apply(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
): Promise<TransitionResult> {
  const cleared = Object.fromEntries(edge.clears.map((c) => [c, null]));
  // The event records every column this edge changed, so the log can rebuild
  // the projection. Edge columns come last: they win over a caller payload key.
  const changed = { ...i.payload, ...i.set, ...cleared };
  const match = and(
    eq(errands.id, i.errandId),
    eq(errands.status, i.expected),
    actorOk(edge, actor),
  );
  const update = (q: Db) =>
    q
      .update(errands)
      .set({
        ...i.set,
        ...cleared,
        status: i.to,
        lastSequenceNumber: sql`${errands.lastSequenceNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(
        edge.unexpiredOnly
          ? and(match, or(isNull(errands.expiresAt), sql`${errands.expiresAt} > now()`))
          : match,
      )
      .returning({ seq: errands.lastSequenceNumber });
  let row: { seq: number } | undefined;
  if (edge.sets.includes('courierId')) {
    // Savepoint: the unique violation must not abort the whole transaction.
    try {
      [row] = await tx.transaction((sp) => update(sp));
    } catch (e) {
      if (isCourierBusy(e)) return { ok: false, reason: 'COURIER_BUSY' };
      throw e;
    }
  } else {
    [row] = await update(tx);
  }

  if (row) {
    await tx.insert(errandEvents).values({
      errandId: i.errandId,
      sequenceNumber: row.seq,
      type: edge.type,
      fromStatus: i.expected,
      toStatus: i.to,
      payload: changed,
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

  // Right status but no row: the actor check, or expiry, refused it.
  if (cur.status === i.expected) {
    const [permitted] = await tx
      .select({ id: errands.id })
      .from(errands)
      .where(match);
    if (!permitted) return { ok: false, reason: 'FORBIDDEN' };
    if (edge.unexpiredOnly) return { ok: false, reason: 'EXPIRED' };
  }

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
    last.type === edge.type &&
    last.actorId === actor
  ) {
    return { ok: true, sequenceNumber: last.sequenceNumber, replayed: true };
  }
  return { ok: false, reason: 'STATE_MISMATCH', currentStatus: cur.status };
}
