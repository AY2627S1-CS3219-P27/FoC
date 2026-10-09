import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errands } from '../db/schema.js';
import { createErrand } from './create.js';
import { rebuildProjection } from './rebuild.js';
import type { Status } from './status.js';
import { transition, type TransitionInput } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const courier = randomUUID();

// The live row minus what events cannot supply (see RebuiltErrand).
async function liveRow(id: string) {
  const [row] = await t.db.select().from(errands).where(eq(errands.id, id));
  const rest: Partial<typeof row> = { ...row };
  delete rest.idempotencyKey;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

async function create(over = {}) {
  const res = await createErrand(t.db, {
    requesterId: randomUUID(),
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    pickupLocation: 'Frontier',
    description: 'no onions',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    ...over,
  });
  return res.errandId;
}

async function step(
  errandId: string,
  expected: Status,
  to: Status,
  extra: Partial<TransitionInput> = {},
) {
  const res = await transition(t.db, { errandId, expected, to, ...extra });
  if (!res.ok) throw new Error(`${expected} -> ${to}: ${res.reason}`);
}

describe('rebuildProjection', () => {
  it('equals the live row after a full lifecycle', async () => {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Pending-Credit');
    await step(id, 'Pending-Credit', 'Open');
    await step(id, 'Open', 'Accepted', { set: { courierId: courier } });
    await step(id, 'Accepted', 'Open'); // courier withdraws
    await step(id, 'Open', 'Accepted', { set: { courierId: courier } });
    await step(id, 'Accepted', 'Picked Up', {
      set: { pickedUpAt: new Date('2030-01-01T01:00:00.000Z') },
    });
    await step(id, 'Picked Up', 'Delivered', {
      set: { deliveredAt: new Date('2030-01-01T02:00:00.000Z') },
    });
    await step(id, 'Delivered', 'Completed');

    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('equals the live row for a cancelled errand', async () => {
    const id = await create({ pickupLocation: undefined, description: undefined, expiresAt: undefined });
    await step(id, 'Pending-Supplier', 'Cancelled', {
      set: { cancellationReason: 'SUPPLIER_UNAVAILABLE' },
    });

    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('returns null for an unknown errand', async () => {
    expect(await rebuildProjection(t.db, randomUUID())).toBeNull();
  });

  it('no longer matches when the live row drifts from the log', async () => {
    const id = await create();
    await t.db.update(errands).set({ courierId: courier }).where(eq(errands.id, id));

    expect(await rebuildProjection(t.db, id)).not.toEqual(await liveRow(id));
  });
});
