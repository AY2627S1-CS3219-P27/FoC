import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import {
  creditAdjusted,
  creditReserved,
  creditTransferFailed,
  creditTransferred,
  supplierValidated,
} from '../../test/payloads.js';
import { errands } from '../db/schema.js';
import { createErrand } from './create.js';
import { rebuildProjection } from './rebuild.js';
import type { Status } from './status.js';
import { SYSTEM, transition, user, type TransitionInput } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const courier = randomUUID();
const requester = randomUUID();

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
    requesterId: requester,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    pickupLocation: 'Frontier',
    description: 'no onions',
    expiryDurationMinutes: 90,
    ...over,
  });
  if (!res.ok) throw new Error(res.reason);
  return res.errandId;
}

async function step(
  errandId: string,
  expected: Status,
  to: Status,
  extra: Partial<TransitionInput> = {},
) {
  const res = await transition(t.db, { errandId, expected, to, actor: SYSTEM, ...extra });
  if (!res.ok) throw new Error(`${expected} -> ${to}: ${res.reason}`);
}

describe('rebuildProjection', () => {
  it('equals the live row after a full lifecycle', async () => {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Reserving-Credit', supplierValidated());
    await step(id, 'Reserving-Credit', 'Open', creditReserved());
    await step(id, 'Open', 'Adjusting-Credit', { actor: user(requester), payload: { newAmount: 9 } });
    await step(id, 'Adjusting-Credit', 'Open', {
      ...creditAdjusted(),
      set: { rewardCredits: 9 },
    });
    await step(id, 'Open', 'Accepted', { actor: user(courier), set: { courierId: courier } });
    await step(id, 'Accepted', 'Open', { actor: user(courier), payload: { reason: 'bike broke down' } }); // courier withdraws
    await step(id, 'Open', 'Accepted', { actor: user(courier), set: { courierId: courier } });
    await step(id, 'Accepted', 'Picked Up', {
      actor: user(courier),
      set: { pickedUpAt: new Date('2030-01-01T01:00:00.000Z') },
    });
    await step(id, 'Picked Up', 'Delivered', {
      actor: user(courier),
      set: { deliveredAt: new Date('2030-01-01T02:00:00.000Z') },
    });
    await step(id, 'Delivered', 'Transferring-Credit');
    await step(id, 'Transferring-Credit', 'Delivered', creditTransferFailed()); // credit rejected
    await step(id, 'Delivered', 'Transferring-Credit');
    await step(id, 'Transferring-Credit', 'Completed', creditTransferred(9));

    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('equals the live row for a cancelled errand', async () => {
    const id = await create({ pickupLocation: undefined, description: undefined, expiryDurationMinutes: undefined });
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
