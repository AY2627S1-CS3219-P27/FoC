import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import { createErrand } from './create.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const input = (over = {}) => ({
  requesterId: randomUUID(),
  supplierId: randomUUID(),
  deliveryLocation: 'COM2',
  rewardCredits: 5,
  expiryDurationMinutes: 60,
  collectionItems: 'bubble tea',
  ...over,
});
const events = (id: string) =>
  t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id));
const outboxFor = (id: string) =>
  t.db.select().from(outboxEvents).where(sql`envelope->'payload'->>'errandId' = ${id}`);

describe('createErrand', () => {
  it('writes a Pending-Supplier errand and ErrandCreated as event 1', async () => {
    const i = input();
    const res = await createErrand(t.db, i);
    if (!res.ok) throw new Error('expected ok');

    const [row] = await t.db
      .select()
      .from(errands)
      .where(eq(errands.id, res.errandId));
    expect(row).toMatchObject({
      status: 'Pending-Supplier',
      lastSequenceNumber: 1,
      requesterId: i.requesterId,
    });
    expect(await events(res.errandId)).toMatchObject([
      {
        sequenceNumber: 1,
        type: 'ErrandCreated',
        fromStatus: null,
        toStatus: 'Pending-Supplier',
        actorId: i.requesterId,
        payload: {
          requesterId: i.requesterId,
          supplierId: i.supplierId,
          deliveryLocation: 'COM2',
          rewardCredits: 5,
          pickupLocation: null,
          description: null,
          expiryDurationMinutes: 60,
          collectionItems: 'bubble tea',
        },
      },
    ]);
  });

  it('records the optional fields in the ErrandCreated payload', async () => {
    const res = await createErrand(
      t.db,
      input({ pickupLocation: 'Frontier', description: 'no onions', expiryDurationMinutes: 120 }),
    );
    if (!res.ok) throw new Error('expected ok');
    expect((await events(res.errandId))[0].payload).toMatchObject({
      pickupLocation: 'Frontier',
      description: 'no onions',
      expiryDurationMinutes: 120,
    });
    const [row] = await t.db.select().from(errands).where(eq(errands.id, res.errandId));
    expect(row.expiresAt).toBeNull(); // set only when the errand goes Open
  });

  it('refuses an expiry duration outside 15 minutes to 168 hours', async () => {
    for (const expiryDurationMinutes of [14, 168 * 60 + 1, 30.5, Number.NaN]) {
      expect(await createErrand(t.db, input({ expiryDurationMinutes }))).toEqual({
        ok: false,
        reason: 'INVALID_FIELDS',
      });
    }
    expect(await createErrand(t.db, input({ expiryDurationMinutes: 15 }))).toMatchObject({ ok: true });
    expect(await createErrand(t.db, input({ expiryDurationMinutes: 168 * 60 }))).toMatchObject({ ok: true });
  });

  it('refuses a missing expiry duration or missing/blank collectionItems', async () => {
    for (const over of [
      { expiryDurationMinutes: undefined },
      { expiryDurationMinutes: null },
      { collectionItems: undefined },
      { collectionItems: '' },
    ]) {
      expect(await createErrand(t.db, input(over))).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    }
  });

  it('returns the original errand for a repeated key', async () => {
    const i = input({ idempotencyKey: 'k1' });
    const first = await createErrand(t.db, i);
    const again = await createErrand(t.db, i);

    expect(first.ok && again.ok && again.errandId === first.errandId).toBe(
      true,
    );
    expect(again).toMatchObject({ replayed: true });
    expect(await events((first as { errandId: string }).errandId)).toHaveLength(
      1,
    );
  });

  it('asks Supplier Service once through the outbox; a replay does not ask again', async () => {
    const i = input({ idempotencyKey: `supplier-${randomUUID()}` });
    const first = await createErrand(t.db, i);
    if (!first.ok) throw new Error('expected ok');
    await createErrand(t.db, i); // replay

    const rows = await outboxFor(first.errandId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      routingKey: 'order.supplier-validation-requested.v1',
      envelope: {
        eventType: 'SupplierValidationRequested',
        publisher: 'order-service',
        payload: { errandId: first.errandId, supplierId: i.supplierId },
      },
    });
  });

  it.each([
    ['a different reward', { rewardCredits: 9 }],
    ['a different delivery location', { deliveryLocation: 'UTown' }],
    ['an added optional field', { description: 'no onions' }],
    ['a different expiry', { expiryDurationMinutes: 120 }],
    ['different collectionItems', { collectionItems: 'coffee' }],
  ])('refuses a repeated key with %s, writing nothing', async (_, change) => {
    const i = input({ idempotencyKey: `changed-${randomUUID()}` });
    const first = await createErrand(t.db, i);
    if (!first.ok) throw new Error('expected ok');

    expect(await createErrand(t.db, { ...i, ...change })).toEqual({
      ok: false,
      reason: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await events(first.errandId)).toHaveLength(1);
  });

  it('still replays a repeated key after the errand has changed', async () => {
    const i = input({ idempotencyKey: `adjusted-${randomUUID()}` });
    const first = await createErrand(t.db, i);
    if (!first.ok) throw new Error('expected ok');
    // The row moves on (e.g. an adjust); the request it came from does not.
    await t.db.update(errands).set({ rewardCredits: 9 }).where(eq(errands.id, first.errandId));

    expect(await createErrand(t.db, i)).toEqual({
      ok: true,
      errandId: first.errandId,
      replayed: true,
    });
  });

  it('creates one errand when the same key races', async () => {
    const i = input({ idempotencyKey: 'race' });
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => createErrand(t.db, i)),
    );

    expect(new Set(rs.map((r) => r.ok && r.errandId)).size).toBe(1);
    expect(rs.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    const rows = await t.db
      .select()
      .from(errands)
      .where(eq(errands.requesterId, i.requesterId));
    expect(rows).toHaveLength(1);
  });

  it('scopes a key to the requester', async () => {
    const a = await createErrand(t.db, input({ idempotencyKey: 'same' }));
    const b = await createErrand(t.db, input({ idempotencyKey: 'same' }));
    expect(a.ok && b.ok && a.errandId !== b.errandId).toBe(true);
  });
});
