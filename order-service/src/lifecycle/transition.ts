import { and, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  COURIER_LOCK_INDEX,
  errandEvents,
  errands,
  idempotencyKeys,
} from '../db/schema.js';
import {
  EDGES,
  findEdge,
  type Col,
  type Edge,
  type UserRole,
} from './edges.js';
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
  a?.kind === 'system'
    ? null
    : a?.kind === 'user' && UUID.test(a.id)
      ? a.id.toLowerCase()
      : undefined;

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
        | 'NOT_FOUND' // errand not found
        | 'IDEMPOTENCY_KEY_REUSED'
        | 'FORBIDDEN' // actor may not take this edge on this errand
        | 'COURIER_BUSY' // courier already holds an active errand
        | 'EXPIRED'; // accept after expires_at
    }
  | { ok: false; reason: 'STATE_MISMATCH'; currentStatus: Status };

const INVALID: TransitionResult = { ok: false, reason: 'INVALID_FIELDS' };
const ILLEGAL: TransitionResult = { ok: false, reason: 'ILLEGAL_TRANSITION' };
const BUSY: TransitionResult = { ok: false, reason: 'COURIER_BUSY' };

// Caller bugs, rejected before the transaction: not an outcome worth storing
// under a key. Returns the refusal, or undefined when the input is well-formed.
function validate(
  i: TransitionInput,
  edge: Edge | undefined,
  actor: string | null | undefined,
): TransitionResult | undefined {
  // undefined = malformed actor (missing, unknown kind, bad id).
  if (actor === undefined) return INVALID;
  if (!edge) {
    // A pair with several exits needs a known `type`; that is a caller bug, not an illegal edge.
    return Array.isArray(EDGES[i.expected]?.[i.to]) ? INVALID : undefined;
  }
  // `set` must carry exactly the columns this edge owns.
  const given = Object.entries(i.set ?? {})
    .filter(([, v]) => v != null)
    .map(([k]) => k);
  if (
    given.length !== edge.sets.length ||
    !edge.sets.every((c) => given.includes(c))
  ) {
    return INVALID;
  }
  // The courier is the actor who accepts, never a name passed in by the caller.
  if (
    edge.sets.includes('courierId') &&
    actor &&
    i.set?.courierId?.toLowerCase() !== actor
  ) {
    return INVALID;
  }
  const reason = i.set?.cancellationReason;
  if (edge.reasons && !edge.reasons.some((r) => r === reason)) return INVALID;
  return undefined;
}

const keyRow = (i: TransitionInput) =>
  and(
    eq(idempotencyKeys.errandId, i.errandId),
    eq(idempotencyKeys.key, i.idempotencyKey!),
  );

// Claim the key. Returns the stored result when the key was already used, else
// undefined (claimed, or no key). A concurrent claimant blocks on the insert
// until the first commits, so it never reads a half-written outcome.
async function claimKey(
  tx: Db,
  i: TransitionInput,
  fingerprint: string,
): Promise<TransitionResult | undefined> {
  if (!i.idempotencyKey) return undefined;
  const [claimed] = await tx
    .insert(idempotencyKeys)
    .values({ errandId: i.errandId, key: i.idempotencyKey, fingerprint })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (claimed) return undefined;

  const [prior] = await tx.select().from(idempotencyKeys).where(keyRow(i));
  if (prior.fingerprint !== fingerprint)
    return { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' };
  const out = prior.outcome as TransitionResult;
  return out.ok ? { ...out, replayed: true } : out;
}

// Same transaction as the transition, so key, status and event commit together.
async function storeOutcome(
  tx: Db,
  i: TransitionInput,
  result: TransitionResult,
) {
  if (!i.idempotencyKey) return;
  await tx.update(idempotencyKeys).set({ outcome: result }).where(keyRow(i));
}

export function transition(
  db: Db,
  i: TransitionInput,
): Promise<TransitionResult> {
  const actor = actorIdOf(i.actor);
  const edge = findEdge(i.expected, i.to, i.type);
  const refused = validate(i, edge, actor);
  if (refused) return Promise.resolve(refused);

  const fingerprint = `${i.expected}|${i.to}|${actor ?? ''}${i.type ? `|${i.type}` : ''}`;

  return db.transaction(async (tx): Promise<TransitionResult> => {
    const replay = await claimKey(tx, i, fingerprint);
    if (replay) return replay;

    const result = edge
      ? await apply(tx, i, edge, actor as string | null)
      : ILLEGAL;
    await storeOutcome(tx, i, result);
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
  const c = ((e as { cause?: object })?.cause ?? e) as {
    code?: string;
    constraint?: string;
  };
  return c.code === '23505' && c.constraint === COURIER_LOCK_INDEX;
};

// The row-level guard the UPDATE and its diagnosis share: right errand, right
// status, permitted actor.
const matchOf = (i: TransitionInput, edge: Edge, actor: string | null) =>
  and(
    eq(errands.id, i.errandId),
    eq(errands.status, i.expected),
    actorOk(edge, actor),
  );

const clearedOf = (edge: Edge) =>
  Object.fromEntries(edge.clears.map((c) => [c, null]));

// The status UPDATE. Returns the new sequence number, undefined if no row
// matched (wrong status, actor, or expired), or COURIER_BUSY.
async function updateErrand(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
): Promise<{ seq: number } | 'COURIER_BUSY' | undefined> {
  const match = matchOf(i, edge, actor);
  const update = (q: Db) =>
    q
      .update(errands)
      .set({
        ...i.set,
        ...clearedOf(edge),
        status: i.to,
        lastSequenceNumber: sql`${errands.lastSequenceNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(
        edge.unexpiredOnly
          ? and(
              match,
              or(isNull(errands.expiresAt), sql`${errands.expiresAt} > now()`),
            )
          : match,
      )
      .returning({ seq: errands.lastSequenceNumber });

  if (!edge.sets.includes('courierId')) return (await update(tx))[0];
  // Savepoint: the unique violation must not abort the whole transaction.
  try {
    return (await tx.transaction((sp) => update(sp)))[0];
  } catch (e) {
    if (isCourierBusy(e)) return 'COURIER_BUSY';
    throw e;
  }
}

// The event records every column this edge changed, so the log can rebuild
// the projection. Edge columns come last: they win over a caller payload key.
async function appendEvent(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
  seq: number,
) {
  await tx.insert(errandEvents).values({
    errandId: i.errandId,
    sequenceNumber: seq,
    type: edge.type,
    fromStatus: i.expected,
    toStatus: i.to,
    payload: { ...i.payload, ...i.set, ...clearedOf(edge) },
    actorId: actor,
  });
}

// The UPDATE matched nothing and wrote nothing: say why.
async function explainNoRow(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
): Promise<TransitionResult> {
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
      .where(matchOf(i, edge, actor));
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

async function apply(
  tx: Db,
  i: TransitionInput,
  edge: Edge,
  actor: string | null,
): Promise<TransitionResult> {
  const row = await updateErrand(tx, i, edge, actor);
  if (row === 'COURIER_BUSY') return BUSY;
  if (!row) return explainNoRow(tx, i, edge, actor);
  await appendEvent(tx, i, edge, actor, row.seq);
  return { ok: true, sequenceNumber: row.seq };
}
