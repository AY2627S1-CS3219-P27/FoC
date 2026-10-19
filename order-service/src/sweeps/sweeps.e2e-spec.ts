import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, idempotencyKeys, outboxEvents } from '../db/schema.js';
import { createErrand } from '../lifecycle/create.js';
import type { Status } from '../lifecycle/status.js';
import { SYSTEM, transition } from '../lifecycle/transition.js';
import { withAdvisoryLock } from './sweep-lock.js';
import { runSweeps, type SweepConfig } from './sweeps.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const MIN = 60_000;
const HOUR = 60 * MIN;
const cfg: SweepConfig = {
  reservingTimeoutMs: 5 * MIN,
  replyTimeoutMs: 2 * MIN,
  resendMax: 2,
  keyTtlMs: 7 * 24 * HOUR,
};
const ago = (ms: number) => new Date(Date.now() - ms);

async function seed(status: Status, over: Partial<typeof errands.$inferInsert> = {}) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: randomUUID(),
    status,
    supplierId: randomUUID(),
    courierId: status === 'Picked Up' || status === 'Delivered' ? randomUUID() : undefined,
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
    ...over,
  });
  return id;
}
const row = async (id: string) =>
  (await t.db.select().from(errands).where(eq(errands.id, id)))[0];
const lastEvent = async (id: string) =>
  (await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id))).sort(
    (a, b) => b.sequenceNumber - a.sequenceNumber,
  )[0];
const outboxFor = (id: string) =>
  t.db.select().from(outboxEvents).where(sql`envelope->'payload'->>'errandId' = ${id}`);

describe('expiresAt', () => {
  it('is null at creation and set to Open time + the requester duration', async () => {
    const res = await createErrand(t.db, {
      requesterId: randomUUID(),
      supplierId: randomUUID(),
      deliveryLocation: 'COM2',
      rewardCredits: 5,
      expiryDurationMinutes: 120,
      collectionItems: 'bubble tea',
    });
    if (!res.ok) throw new Error('expected ok');
    expect((await row(res.errandId)).expiresAt).toBeNull();

    for (const [expected, to] of [
      ['Pending-Supplier', 'Reserving-Credit'],
      ['Reserving-Credit', 'Open'],
    ] as const) {
      const payload =
        to === 'Open'
          ? { creditEventId: randomUUID(), creditTransactionId: randomUUID(), reservedAmount: 5 }
          : undefined;
      const r = await transition(t.db, { errandId: res.errandId, expected, to, actor: SYSTEM, payload });
      expect(r.ok).toBe(true);
    }
    const open = await row(res.errandId);
    const ms = open.expiresAt!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(119 * MIN);
    expect(ms).toBeLessThanOrEqual(120 * MIN);
    // the event carries it, so rebuild replays the same value
    expect((await lastEvent(res.errandId)).payload).toMatchObject({
      expiresAt: open.expiresAt!.toISOString(),
    });
  });
});

describe('sweeps', () => {
  it('cancels expired Open errands only, with ERRAND_EXPIRED and a release', async () => {
    const expired = await seed('Open', { expiresAt: ago(MIN) });
    const live = await seed('Open', { expiresAt: new Date(Date.now() + HOUR) });
    const noExpiry = await seed('Open');

    expect((await runSweeps(t.db, cfg)).expired).toBeGreaterThanOrEqual(1);

    expect(await row(expired)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'ERRAND_EXPIRED',
    });
    expect((await row(live)).status).toBe('Open');
    expect((await row(noExpiry)).status).toBe('Open');
    expect(await outboxFor(expired)).toHaveLength(1);
  });

  it('cancels Picked Up errands 24h after pickup', async () => {
    const late = await seed('Picked Up', { pickedUpAt: ago(25 * HOUR) });
    const fresh = await seed('Picked Up', { pickedUpAt: ago(HOUR) });
    await runSweeps(t.db, cfg);
    expect(await row(late)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'PICKUP_TIME_EXCEEDED',
    });
    expect((await row(fresh)).status).toBe('Picked Up');
  });

  it('cancels a Reserving-Credit errand past its window with CREDIT_TIMEOUT and a defensive release', async () => {
    const stuck = await seed('Reserving-Credit', { updatedAt: ago(10 * MIN) });
    const fresh = await seed('Reserving-Credit');
    await runSweeps(t.db, cfg);
    expect(await row(stuck)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'CREDIT_TIMEOUT',
    });
    expect((await row(fresh)).status).toBe('Reserving-Credit');
    expect(await outboxFor(stuck)).toHaveLength(1);
  });

  it('auto-completes a Delivered errand after 24h, sending the transfer notice', async () => {
    const due = await seed('Delivered', { deliveredAt: ago(25 * HOUR) });
    const fresh = await seed('Delivered', { deliveredAt: ago(HOUR) });
    await runSweeps(t.db, cfg);
    expect((await row(due)).status).toBe('Transferring-Credit');
    expect((await row(fresh)).status).toBe('Delivered');
    expect(await outboxFor(due)).toHaveLength(1);
  });

  it('skips auto-complete after a rejected transfer', async () => {
    const id = await seed('Delivered', { deliveredAt: ago(25 * HOUR) });
    await runSweeps(t.db, cfg); // -> Transferring-Credit
    await transition(t.db, {
      errandId: id,
      expected: 'Transferring-Credit',
      to: 'Delivered',
      actor: SYSTEM,
      payload: { creditEventId: randomUUID(), reason: 'INSUFFICIENT_FUNDS' },
    });
    expect((await lastEvent(id)).type).toBe('CreditTransferFailed');

    await runSweeps(t.db, cfg);
    expect((await row(id)).status).toBe('Delivered');
  });

  it('two concurrent ticks over the same errand act once', async () => {
    const id = await seed('Open', { expiresAt: ago(MIN) });
    await Promise.all([runSweeps(t.db, cfg), runSweeps(t.db, cfg)]);
    expect((await row(id)).status).toBe('Cancelled');
    expect(await outboxFor(id)).toHaveLength(1);
    expect((await row(id)).lastSequenceNumber).toBe(1);
  });
});

describe('credit reply timeout', () => {
  async function inFlight(status: 'Transferring-Credit' | 'Adjusting-Credit', ageMs: number) {
    const id = await seed('Delivered', { deliveredAt: ago(25 * HOUR) });
    if (status === 'Transferring-Credit') {
      await transition(t.db, { errandId: id, expected: 'Delivered', to: status, actor: SYSTEM });
    } else {
      await t.db.update(errands).set({ status: 'Open' }).where(eq(errands.id, id));
      await transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: status,
        actor: { kind: 'user', id: (await row(id)).requesterId },
        payload: { newAmount: 9 },
      });
    }
    await t.db.update(errands).set({ updatedAt: ago(ageMs) }).where(eq(errands.id, id));
    // the relay has delivered the original notice
    await t.db
      .update(outboxEvents)
      .set({ publishedAt: ago(ageMs) })
      .where(sql`envelope->'payload'->>'errandId' = ${id}`);
    return id;
  }

  it('re-queues the original notice (same event id) and never reverts', async () => {
    const id = await inFlight('Transferring-Credit', 3 * MIN);
    const [before] = await outboxFor(id);

    expect((await runSweeps(t.db, cfg)).resent).toBe(1);

    const [after] = await outboxFor(id);
    expect(after.eventId).toBe(before.eventId);
    expect(after.publishedAt).toBeNull();
    expect((await row(id)).status).toBe('Transferring-Credit');
    // unpublished again, so nothing more to do until the relay re-sends
    expect((await runSweeps(t.db, cfg)).resent).toBe(0);
  });

  it('does the same for an adjustment', async () => {
    const id = await inFlight('Adjusting-Credit', 3 * MIN);
    expect((await runSweeps(t.db, cfg)).resent).toBe(1);
    expect((await row(id)).status).toBe('Adjusting-Credit');
  });

  it('leaves a recent errand alone and stops re-sending past the cap', async () => {
    const recent = await inFlight('Transferring-Credit', MIN);
    const capped = await inFlight('Transferring-Credit', 7 * MIN); // > 2 * (2 + 1) windows
    await runSweeps(t.db, cfg);
    expect((await outboxFor(recent))[0].publishedAt).not.toBeNull();
    expect((await outboxFor(capped))[0].publishedAt).not.toBeNull();
    expect((await row(capped)).status).toBe('Transferring-Credit');
  });
});

describe('idempotency key retention', () => {
  it('deletes keys past the TTL and keeps newer ones', async () => {
    const id = await seed('Open');
    await t.db.insert(idempotencyKeys).values([
      { errandId: id, key: 'old', fingerprint: 'f', createdAt: ago(8 * 24 * HOUR) },
      { errandId: id, key: 'new', fingerprint: 'f', createdAt: ago(HOUR) },
    ]);

    expect((await runSweeps(t.db, cfg)).keysPruned).toBeGreaterThanOrEqual(1);

    const left = await t.db
      .select({ key: idempotencyKeys.key })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.errandId, id));
    expect(left).toEqual([{ key: 'new' }]);
  });
});

describe('withAdvisoryLock', () => {
  it('skips while another session holds the lock, and releases it afterwards', async () => {
    const key = 987654;
    let inner = 0;
    const result = await withAdvisoryLock(t.pool, key, async () => {
      const nested = await withAdvisoryLock(t.pool, key, async () => ++inner);
      expect(nested).toEqual({ ran: false });
      return 'outer';
    });
    expect(result).toEqual({ ran: true, value: 'outer' });
    expect(inner).toBe(0);
    expect(await withAdvisoryLock(t.pool, key, async () => 'again')).toEqual({
      ran: true,
      value: 'again',
    });
  });

  it('releases the lock when the work throws', async () => {
    const key = 987655;
    await expect(
      withAdvisoryLock(t.pool, key, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await withAdvisoryLock(t.pool, key, async () => 1)).ran).toBe(true);
  });
});
