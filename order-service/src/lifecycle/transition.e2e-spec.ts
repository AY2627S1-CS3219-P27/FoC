import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands } from '../db/schema.js';
import type { Status } from './status.js';
import { transition } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const requester = randomUUID();
const courier = randomUUID();

async function seed(status: Status) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: requester,
    status,
    supplierId: randomUUID(),
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
      actorId: courier,
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
      errandId: id,
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
      errandId: id,
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
          actorId: c,
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
      set: { courierId: courier },
    });

    const res = await transition(t.db, {
      ...base,
      expected: 'Accepted',
      to: 'Open',
    });

    expect(res).toEqual({ ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await events(id)).toHaveLength(1);
    expect((await projection(id)).status).toBe('Accepted');
  });

  it('reports an unknown errand', async () => {
    const res = await transition(t.db, {
      errandId: randomUUID(),
      expected: 'Open',
      to: 'Accepted',
      set: { courierId: courier },
    });

    expect(res).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('rejects Picked Up without pickedUpAt', async () => {
    const id = await seed('Accepted');
    const res = await transition(t.db, {
      errandId: id,
      expected: 'Accepted',
      to: 'Picked Up',
    });
    expect(res).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    expect((await projection(id)).status).toBe('Accepted');
  });

  it('rejects a column the edge does not own', async () => {
    const id = await seed('Open');
    const res = await transition(t.db, {
      errandId: id,
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
      set: { courierId: courier },
    });
    await transition(t.db, { errandId: id, expected: 'Accepted', to: 'Open' });
    expect((await projection(id)).courierId).toBeNull();
  });

  it('requires a cancellation reason and records it', async () => {
    const id = await seed('Open');
    const bare = {
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
});
