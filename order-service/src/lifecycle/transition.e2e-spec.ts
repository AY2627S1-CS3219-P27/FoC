import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands } from '../db/schema.js';
import type { Status } from './status.js';
import { SYSTEM, transition, user, type Actor } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const requester = randomUUID();
// Fresh per test: the one-active-errand-per-courier index forbids reuse.
let courier: string;
beforeEach(() => {
  courier = randomUUID();
});

async function seed(status: Status) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: requester,
    status,
    supplierId: randomUUID(),
    courierId: status === 'Accepted' || status === 'Picked Up' ? courier : undefined,
    deliveryLocation: 'COM2',
    rewardCredits: 5,
  });
  return id;
}

const events = (id: string) =>
  t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id));
const projection = async (id: string) =>
  (await t.db.select().from(errands).where(eq(errands.id, id)))[0];

describe('transition', () => {
  it('moves the errand and appends one event in the same step', async () => {
    const id = await seed('Open');

    const res = await transition(t.db, {
      errandId: id,
      expected: 'Open',
      to: 'Accepted',
      actor: user(courier),
      payload: { courierId: courier },
      set: { courierId: courier },
    });

    expect(res).toEqual({ ok: true, sequenceNumber: 1 });
    expect(await projection(id)).toMatchObject({
      status: 'Accepted',
      lastSequenceNumber: 1,
      courierId: courier,
    });
    expect(await events(id)).toMatchObject([
      {
        sequenceNumber: 1,
        type: 'ErrandAccepted',
        fromStatus: 'Open',
        toStatus: 'Accepted',
        actorId: courier,
        payload: { courierId: courier },
      },
    ]);
  });

  it('rejects an edge not in the state model and writes nothing', async () => {
    const id = await seed('Open');

    const res = await transition(t.db, {
      actor: SYSTEM, errandId: id,
      expected: 'Open',
      to: 'Completed',
    });

    expect(res).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
    expect(await events(id)).toHaveLength(0);
    expect((await projection(id)).status).toBe('Open');
  });

  it('returns the current state when the errand is no longer in the expected one', async () => {
    const id = await seed('Accepted');

    const res = await transition(t.db, {
      actor: user(courier), errandId: id,
      expected: 'Open',
      to: 'Accepted',
      set: { courierId: courier },
    });

    expect(res).toEqual({
      ok: false,
      reason: 'STATE_MISMATCH',
      currentStatus: 'Accepted',
    });
    expect(await events(id)).toHaveLength(0);
    expect((await projection(id)).lastSequenceNumber).toBe(0);
  });

  it('lets exactly one of many concurrent accepts win (single assignment)', async () => {
    const id = await seed('Open');
    const couriers = Array.from({ length: 10 }, () => randomUUID());

    const results = await Promise.all(
      couriers.map((c) =>
        transition(t.db, {
          errandId: id,
          expected: 'Open',
          to: 'Accepted',
          actor: user(c),
          set: { courierId: c },
        }),
      ),
    );

    const winners = results.flatMap((r, n) => (r.ok ? [couriers[n]] : []));
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual(
      Array(9).fill({
        ok: false,
        reason: 'STATE_MISMATCH',
        currentStatus: 'Accepted',
      }),
    );
    expect(await events(id)).toHaveLength(1);
    expect((await projection(id)).courierId).toBe(winners[0]);
  });

  it('numbers events 1, 2, 3 without gaps across successive transitions', async () => {
    const id = await seed('Open');
    const step = (expected: Status, to: Status) =>
      transition(t.db, {
        errandId: id,
        expected,
        to,
        actor: user(courier),
        set: to === 'Accepted' ? { courierId: courier } : undefined,
      });

    await step('Open', 'Accepted');
    await step('Accepted', 'Open');
    await step('Open', 'Accepted');

    expect(
      (await events(id)).map((e) => e.sequenceNumber).sort((a, b) => a - b),
    ).toEqual([1, 2, 3]);
  });

  it('replays a repeated idempotency key instead of transitioning twice', async () => {
    const id = await seed('Open');
    const req = {
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(courier),
      set: { courierId: courier },
      idempotencyKey: 'key-1',
    };

    const first = await transition(t.db, req);
    const second = await transition(t.db, req);

    expect(first).toEqual({ ok: true, sequenceNumber: 1 });
    expect(second).toEqual({ ok: true, sequenceNumber: 1, replayed: true });
    expect(await events(id)).toHaveLength(1);
  });

  it('replays the loser of two concurrent requests that share a key', async () => {
    const id = await seed('Open');
    const req = {
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(courier),
      set: { courierId: courier },
      idempotencyKey: 'key-2',
    };

    const results = await Promise.all([
      transition(t.db, req),
      transition(t.db, req),
    ]);

    expect(results.every((r) => r.ok && r.sequenceNumber === 1)).toBe(true);
    expect(await events(id)).toHaveLength(1);
  });

  it('refuses to replay a key that was used for a different transition', async () => {
    const id = await seed('Open');
    const base = { errandId: id, idempotencyKey: 'key-3' };
    await transition(t.db, {
      ...base,
      expected: 'Open',
      to: 'Accepted',
      actor: user(courier),
      set: { courierId: courier },
    });

    const res = await transition(t.db, {
      ...base,
      actor: user(courier),
      expected: 'Accepted',
      to: 'Open',
    });

    expect(res).toEqual({ ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await events(id)).toHaveLength(1);
    expect((await projection(id)).status).toBe('Accepted');
  });

  it('replays a rejected request after the state changed (strict replay)', async () => {
    const id = await seed('Accepted');
    const loser = randomUUID();
    const req = {
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(loser),
      set: { courierId: loser },
      idempotencyKey: 'key-4',
    };
    const first = await transition(t.db, req);
    // The errand goes back to Open, so a fresh attempt would now succeed.
    await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open', actor: user(courier) });

    const second = await transition(t.db, req);

    expect(first).toEqual({
      ok: false,
      reason: 'STATE_MISMATCH',
      currentStatus: 'Accepted',
    });
    expect(second).toEqual(first);
    expect((await projection(id)).status).toBe('Open');
  });

  it('replays the stored outcome, sequence number included', async () => {
    const id = await seed('Open');
    const req = {
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(courier),
      set: { courierId: courier },
      idempotencyKey: 'key-5',
    };
    const first = await transition(t.db, req);
    await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open', actor: user(courier) });

    const second = await transition(t.db, req);

    expect(first).toEqual({ ok: true, sequenceNumber: 1 });
    expect(second).toEqual({ ok: true, sequenceNumber: 1, replayed: true });
    expect(await events(id)).toHaveLength(2);
  });

  it('stores an illegal-edge outcome under the key too', async () => {
    const id = await seed('Open');
    const req = {
      actor: SYSTEM,
      errandId: id,
      expected: 'Open' as const,
      to: 'Completed' as const,
      idempotencyKey: 'key-6',
    };
    expect(await transition(t.db, req)).toEqual({
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
    });
    expect(await transition(t.db, req)).toEqual({
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
    });
  });

  describe('keyless repeat', () => {
    const accept = (id: string, who: string) => ({
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(who),
      set: { courierId: who },
    });

    it('answers a courier double-tap with ok, replayed', async () => {
      const id = await seed('Open');
      await transition(t.db, accept(id, courier));

      expect(await transition(t.db, accept(id, courier))).toEqual({
        ok: true,
        sequenceNumber: 1,
        replayed: true,
      });
      expect(await events(id)).toHaveLength(1);
    });

    it('still rejects a stale duplicate from a courier who lost', async () => {
      const id = await seed('Open');
      const loser = randomUUID();
      await transition(t.db, accept(id, courier));
      const first = await transition(t.db, accept(id, loser));
      const again = await transition(t.db, accept(id, loser));

      const mismatch = {
        ok: false,
        reason: 'STATE_MISMATCH',
        currentStatus: 'Accepted',
      };
      expect(first).toEqual(mismatch);
      expect(again).toEqual(mismatch);
    });

    it('counts a duplicate sweep tick (null actor) as a repeat', async () => {
      const id = await seed('Open');
      const tick = {
        actor: SYSTEM,
        errandId: id,
        expected: 'Open' as const,
        to: 'Cancelled' as const,
        set: { cancellationReason: 'ERRAND_EXPIRED' },
      };
      await transition(t.db, tick);

      expect(await transition(t.db, { ...tick, actor: SYSTEM })).toEqual({
        ok: true,
        sequenceNumber: 1,
        replayed: true,
      });
    });

    it('matches the whole edge, not only the target state', async () => {
      const id = await seed('Accepted');
      await transition(t.db, {
        errandId: id,
        expected: 'Accepted',
        to: 'Open',
        actor: user(courier),
      });

      // Latest event is Accepted -> Open; Reserving-Credit -> Open is another edge.
      const res = await transition(t.db, {
        actor: SYSTEM, errandId: id,
        expected: 'Reserving-Credit',
        to: 'Open',
      });

      expect(res).toEqual({
        ok: false,
        reason: 'STATE_MISMATCH',
        currentStatus: 'Open',
      });
    });
  });

  it('reports an unknown errand', async () => {
    const res = await transition(t.db, {
      actor: user(courier), errandId: randomUUID(),
      expected: 'Open',
      to: 'Accepted',
      set: { courierId: courier },
    });

    expect(res).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('rejects Picked Up without pickedUpAt', async () => {
    const id = await seed('Accepted');
    const res = await transition(t.db, {
      actor: user(courier), errandId: id,
      expected: 'Accepted',
      to: 'Picked Up',
    });
    expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    expect((await projection(id)).status).toBe('Accepted');
  });

  it('rejects a column the edge does not own', async () => {
    const id = await seed('Open');
    const res = await transition(t.db, {
      actor: user(courier), errandId: id,
      expected: 'Open',
      to: 'Accepted',
      set: { courierId: courier, deliveredAt: new Date() },
    });
    expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
  });

  it('clears courierId when the courier withdraws', async () => {
    const id = await seed('Open');
    await transition(t.db, {
      errandId: id,
      expected: 'Open',
      to: 'Accepted',
      actor: user(courier),
      set: { courierId: courier },
    });
    await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open', actor: user(courier) });
    expect((await projection(id)).courierId).toBeNull();
  });

  it('requires a cancellation reason and records it', async () => {
    const id = await seed('Open');
    const bare = {
      actor: SYSTEM,
      errandId: id,
      expected: 'Open' as const,
      to: 'Cancelled' as const,
    };
    expect(await transition(t.db, bare)).toEqual({
      ok: false,
      reason: 'INVALID_FIELDS',
    });
    await transition(t.db, {
      ...bare,
      set: { cancellationReason: 'ERRAND_EXPIRED' },
    });
    expect(await projection(id)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'ERRAND_EXPIRED',
    });
  });

  describe('event payload', () => {
    const lastPayload = async (id: string) => {
      const all = await events(id);
      return all[all.length - 1].payload;
    };

    it('records the column an edge sets, without the caller repeating it', async () => {
      const id = await seed('Open');
      await transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Accepted',
        actor: user(courier),
        set: { courierId: courier },
      });
      expect(await lastPayload(id)).toEqual({ courierId: courier });
    });

    it('records a cleared column as null', async () => {
      const id = await seed('Accepted');
      await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open', actor: user(courier) });
      expect(await lastPayload(id)).toEqual({ courierId: null });
    });

    it('records a timestamp as an ISO string', async () => {
      const id = await seed('Accepted');
      const pickedUpAt = new Date('2030-01-01T00:00:00.000Z');
      await transition(t.db, {
        errandId: id,
        expected: 'Accepted',
        to: 'Picked Up',
        actor: user(courier),
        set: { pickedUpAt },
      });
      expect(await lastPayload(id)).toEqual({
        pickedUpAt: '2030-01-01T00:00:00.000Z',
      });
    });

    it('records the cancellation reason', async () => {
      const id = await seed('Open');
      await transition(t.db, {
        actor: SYSTEM, errandId: id,
        expected: 'Open',
        to: 'Cancelled',
        set: { cancellationReason: 'ERRAND_EXPIRED' },
      });
      expect(await lastPayload(id)).toEqual({
        cancellationReason: 'ERRAND_EXPIRED',
      });
    });

    it('keeps the caller payload alongside the edge columns', async () => {
      const id = await seed('Open');
      await transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Accepted',
        actor: user(courier),
        payload: { note: 'hi' },
        set: { courierId: courier },
      });
      expect(await lastPayload(id)).toEqual({ note: 'hi', courierId: courier });
    });

    it('lets the edge column win over a clashing caller payload key', async () => {
      const id = await seed('Open');
      await transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Accepted',
        actor: user(courier),
        payload: { courierId: randomUUID() },
        set: { courierId: courier },
      });
      expect(await lastPayload(id)).toEqual({ courierId: courier });
    });

    it('writes an empty payload for an edge with no columns', async () => {
      const id = await seed('Pending-Supplier');
      await transition(t.db, {
        actor: SYSTEM, errandId: id,
        expected: 'Pending-Supplier',
        to: 'Reserving-Credit',
      });
      expect(await lastPayload(id)).toEqual({});
    });
  });

  describe('actor rules (L4)', () => {
    const accept = (id: string, actor: Actor) =>
      transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Accepted',
        actor,
        set: { courierId: actor.kind === 'user' ? actor.id : requester },
      });

    it('refuses the requester accepting their own errand', async () => {
      const id = await seed('Open');
      expect(await accept(id, user(requester))).toEqual({ ok: false, reason: 'FORBIDDEN' });
      expect((await projection(id)).status).toBe('Open');
      expect(await events(id)).toHaveLength(0);
    });

    it('rejects an accept whose courierId is not the actor', async () => {
      const id = await seed('Open');
      const res = await transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Accepted',
        actor: user(randomUUID()),
        set: { courierId: requester },
      });
      expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
      expect((await projection(id)).courierId).toBeNull();
    });

    it('refuses the system on a user-only edge', async () => {
      const id = await seed('Open');
      const res = await transition(t.db, {
        actor: SYSTEM, errandId: id,
        expected: 'Open',
        to: 'Accepted',
        set: { courierId: courier },
        idempotencyKey: 'sys-accept',
      });
      // Caught before the transaction, so nothing is stored under the key.
      expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    });

    it('accepts an uppercase user id and stores it lowercased', async () => {
      const id = await seed('Open');
      const up = courier.toUpperCase();
      const res = await transition(t.db, { errandId: id, expected: 'Open', to: 'Accepted', actor: user(up), set: { courierId: up } });
      expect(res).toMatchObject({ ok: true });
      expect((await projection(id)).courierId).toBe(courier);
    });

    it('never treats a missing or malformed actor as the system', async () => {
      const id = await seed('Reserving-Credit');
      const bad = [undefined, null, {}, { kind: 'user' }, { kind: 'user', id: 'nope' }, { kind: 'user', id: undefined }];
      for (const actor of bad) {
        const res = await transition(t.db, {
          errandId: id,
          expected: 'Reserving-Credit',
          to: 'Open',
          actor: actor as never,
        });
        expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
      }
      expect((await projection(id)).status).toBe('Reserving-Credit');
      expect(await events(id)).toHaveLength(0);
    });

    it('refuses a user on a system-only edge', async () => {
      const id = await seed('Reserving-Credit');
      const res = await transition(t.db, { errandId: id, expected: 'Reserving-Credit', to: 'Open', actor: user(requester) });
      expect(res).toEqual({ ok: false, reason: 'FORBIDDEN' });
    });

    it('lets only the assigned courier pick up, withdraw or deliver', async () => {
      const id = await seed('Accepted');
      const stranger = randomUUID();
      const pickedUpAt = new Date();
      for (const actor of [user(stranger), user(requester), SYSTEM]) {
        expect(
          await transition(t.db, {
            errandId: id,
            expected: 'Accepted',
            to: 'Picked Up',
            actor,
            set: { pickedUpAt },
          }),
        ).toEqual({ ok: false, reason: 'FORBIDDEN' });
      }
      expect(
        await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open', actor: user(stranger) }),
      ).toEqual({ ok: false, reason: 'FORBIDDEN' });
    });

    it('lets the requester cancel but not a courier', async () => {
      const id = await seed('Open');
      const cancel = (actor: Actor) =>
        transition(t.db, {
          errandId: id,
          expected: 'Open',
          to: 'Cancelled',
          actor,
          set: { cancellationReason: 'REQUESTER_CANCELLED' },
        });
      expect(await cancel(user(courier))).toEqual({ ok: false, reason: 'FORBIDDEN' });
      expect(await cancel(user(requester))).toMatchObject({ ok: true });
    });

    it('refuses the requester cancelling once picked up; the system may', async () => {
      const id = await seed('Picked Up');
      const cancel = (actor: Actor, cancellationReason: 'REQUESTER_CANCELLED' | 'PICKUP_TIME_EXCEEDED') =>
        transition(t.db, {
          errandId: id,
          expected: 'Picked Up',
          to: 'Cancelled',
          actor,
          set: { cancellationReason },
        });
      // No reason is both allowed on this edge and a user reason.
      expect(await cancel(user(requester), 'REQUESTER_CANCELLED')).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
      expect(await cancel(SYSTEM, 'PICKUP_TIME_EXCEEDED')).toMatchObject({ ok: true });
    });

    it('reports a stale expectation as STATE_MISMATCH, not FORBIDDEN', async () => {
      const id = await seed('Accepted');
      expect(await accept(id, user(randomUUID()))).toMatchObject({ reason: 'STATE_MISMATCH' });
    });
  });

  describe('courier lock (L5)', () => {
    it('refuses a second active errand and leaves the first untouched', async () => {
      const a = await seed('Open');
      const b = await seed('Open');
      const accept = (id: string) =>
        transition(t.db, {
          errandId: id,
          expected: 'Open',
          to: 'Accepted',
          actor: user(courier),
          set: { courierId: courier },
          idempotencyKey: 'lock-' + id,
        });
      expect(await accept(a)).toMatchObject({ ok: true });
      expect(await accept(b)).toEqual({ ok: false, reason: 'COURIER_BUSY' });
      expect((await projection(b)).status).toBe('Open');
      expect(await events(b)).toHaveLength(0);
      // The transaction survived the violation; the key was released, not stored.
      expect(await accept(b)).toEqual({ ok: false, reason: 'COURIER_BUSY' });
      await transition(t.db, { errandId: a, expected: 'Accepted', to: 'Open', actor: user(courier) });
      expect(await accept(b)).toMatchObject({ ok: true });
    });

    it('lets one of two concurrent accepts by the same courier win', async () => {
      const ids = [await seed('Open'), await seed('Open')];
      const results = await Promise.all(
        ids.map((errandId) =>
          transition(t.db, { errandId, expected: 'Open', to: 'Accepted', actor: user(courier), set: { courierId: courier } }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === 'COURIER_BUSY')).toHaveLength(1);
    });

    it('frees the courier after withdrawing', async () => {
      const a = await seed('Open');
      const b = await seed('Open');
      const base = { expected: 'Open' as const, to: 'Accepted' as const, actor: user(courier), set: { courierId: courier } };
      await transition(t.db, { ...base, errandId: a });
      await transition(t.db, { errandId: a, expected: 'Accepted', to: 'Open', actor: user(courier) });
      expect(await transition(t.db, { ...base, errandId: b })).toMatchObject({ ok: true });
    });
  });

  describe('expiry on accept (L6)', () => {
    const accept = (id: string) =>
      transition(t.db, { errandId: id, expected: 'Open', to: 'Accepted', actor: user(courier), set: { courierId: courier } });
    const expireAt = (id: string, at: Date) =>
      t.db.update(errands).set({ expiresAt: at }).where(eq(errands.id, id));

    it('refuses an errand past its expiry', async () => {
      const id = await seed('Open');
      await expireAt(id, new Date(Date.now() - 1000));
      expect(await accept(id)).toEqual({ ok: false, reason: 'EXPIRED' });
      expect((await projection(id)).status).toBe('Open');
    });

    it('accepts before expiry and when there is none', async () => {
      const id = await seed('Open');
      await expireAt(id, new Date(Date.now() + 60_000));
      expect(await accept(id)).toMatchObject({ ok: true });
    });
  });

  describe('cancellation reasons (L7)', () => {
    it('rejects a reason outside the closed set or the edge subset', async () => {
      const id = await seed('Open');
      for (const cancellationReason of ['because', 'SUPPLIER_UNAVAILABLE']) {
        expect(
          await transition(t.db, { actor: SYSTEM, errandId: id, expected: 'Open', to: 'Cancelled', set: { cancellationReason } }),
        ).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
      }
      expect((await projection(id)).status).toBe('Open');
    });

    it('ties reasons to the kind of actor', async () => {
      const id = await seed('Open');
      const cancel = (actor: Actor, cancellationReason: string) =>
        transition(t.db, { actor, errandId: id, expected: 'Open', to: 'Cancelled', set: { cancellationReason } });
      expect(await cancel(user(requester), 'ERRAND_EXPIRED')).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
      expect(await cancel(SYSTEM, 'REQUESTER_CANCELLED')).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    });
  });

  describe('idempotency fingerprint', () => {
    it('refuses a reused key carrying different content', async () => {
      const id = await seed('Reserving-Credit');
      const cancel = (cancellationReason: string) =>
        transition(t.db, {
          actor: SYSTEM, errandId: id, expected: 'Reserving-Credit', to: 'Cancelled',
          set: { cancellationReason }, idempotencyKey: 'k',
        });
      expect(await cancel('INSUFFICIENT_CREDITS')).toMatchObject({ ok: true });
      expect(await cancel('INSUFFICIENT_CREDITS')).toMatchObject({ ok: true, replayed: true });
      expect(await cancel('MISSING_BALANCE')).toEqual({ ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' });
    });
  });
});
