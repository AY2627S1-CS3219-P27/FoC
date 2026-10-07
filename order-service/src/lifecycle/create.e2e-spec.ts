import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands } from '../db/schema.js';
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
  ...over,
});
const events = (id: string) =>
  t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id));

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
      },
    ]);
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
