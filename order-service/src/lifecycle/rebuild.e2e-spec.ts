import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { supplierValidated } from '../../test/payloads.js';
import { errands } from '../db/schema.js';
import { createErrand } from './create.js';
import { rebuildProjection } from './rebuild.js';
import type { Status } from './status.js';
import { SYSTEM, admin as adminActor, transition, user, type TransitionInput } from './transition.js';

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

const creditIds = () => ({ creditEventId: randomUUID(), creditTransactionId: randomUUID() });
const creditReserved = () => ({ ...creditIds(), reservedAmount: 5 });
const transferFailed = () => ({ creditEventId: randomUUID(), reason: 'INSUFFICIENT_FUNDS' });

async function create(over = {}) {
  const res = await createErrand(t.db, {
    requesterId: requester,
    supplierId: randomUUID(),
    deliveryBuildingId: randomUUID(),
    deliveryDetail: 'Level 3 04-02',
    rewardCredits: 5,
    description: 'no onions',
    expiryDurationMinutes: 90,
    collectionItems: 'bubble tea',
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
    await step(id, 'Reserving-Credit', 'Open', { payload: creditReserved() });
    await step(id, 'Open', 'Adjusting-Credit', { actor: user(requester), payload: { newAmount: 9 } });
    await step(id, 'Adjusting-Credit', 'Open', {
      type: 'CreditAdjusted',
      payload: creditIds(),
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
    await step(id, 'Transferring-Credit', 'Completed', {
      payload: { ...creditIds(), transferredAmount: 9 },
    });

    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('equals the live row after in-place edits and supplier revalidations (F2)', async () => {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Reserving-Credit', supplierValidated());
    await step(id, 'Reserving-Credit', 'Open', { payload: creditReserved() });
    await step(id, 'Open', 'Open', {
      actor: user(requester),
      set: { description: 'ring twice', deliveryDetail: 'Level 5' },
      payload: { expiryDurationMinutes: 240 },
    });
    const pending = () => ({ pendingSupplierId: randomUUID(), pendingDeliveryBuildingId: randomUUID() });
    // A refused revalidation keeps the old supplier...
    await step(id, 'Open', 'Revalidating-Supplier', { actor: user(requester), set: pending() });
    await step(id, 'Revalidating-Supplier', 'Open', {
      type: 'SupplierRevalidationFailed',
      payload: { supplierEventId: randomUUID(), supplierOutcome: 'INACTIVE' },
    });
    // ...an accepted one switches to the new one.
    const next = pending();
    await step(id, 'Open', 'Revalidating-Supplier', { actor: user(requester), set: next, payload: { expiryDurationMinutes: 300 } });
    const validated = supplierValidated();
    const { deliveryVenue: _v, deliveryLatitude: _a, deliveryLongitude: _o, ...kept } = validated.set;
    await step(id, 'Revalidating-Supplier', 'Open', {
      type: 'SupplierRevalidated',
      payload: validated.payload,
      set: { ...kept, pickupName: 'New Spot', supplierId: next.pendingSupplierId, deliveryBuildingId: next.pendingDeliveryBuildingId },
    });

    const live = await liveRow(id);
    expect(live).toMatchObject({
      supplierId: next.pendingSupplierId,
      deliveryBuildingId: next.pendingDeliveryBuildingId,
      pickupName: 'New Spot',
      pendingSupplierId: null,
      description: 'ring twice',
    });
    expect(await rebuildProjection(t.db, id)).toEqual(live);
  });

  it('equals the live row when credit rejects the transfer', async () => {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Reserving-Credit', supplierValidated());
    await step(id, 'Reserving-Credit', 'Open', { payload: creditReserved() });
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
    await step(id, 'Transferring-Credit', 'Incomplete', { payload: transferFailed() });

    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('reproduces the settlement columns, and a rejection clears them', async () => {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Reserving-Credit', supplierValidated());
    await step(id, 'Reserving-Credit', 'Open', { payload: creditReserved() });
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
    await step(id, 'Transferring-Credit', 'Incomplete', { payload: transferFailed() });

    const admin = adminActor(randomUUID());
    const request = (amount: number) =>
      step(id, 'Incomplete', 'Settling-Credit', {
        actor: admin,
        set: { settlementAmount: amount, settlementNote: 'split it' },
      });

    await request(2);
    expect(await rebuildProjection(t.db, id)).toMatchObject({
      settlementAmount: 2,
      settlementNote: 'split it',
    });
    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));

    await step(id, 'Settling-Credit', 'Incomplete', { payload: transferFailed() });
    expect(await rebuildProjection(t.db, id)).toMatchObject({
      settlementAmount: null,
      settlementNote: null,
    });
    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));

    await request(5);
    await step(id, 'Settling-Credit', 'Resolved', {
      payload: {
        creditEventId: randomUUID(),
        courierCreditTransactionId: randomUUID(),
        requesterCreditTransactionId: null,
      },
    });
    expect(await rebuildProjection(t.db, id)).toMatchObject({
      status: 'Resolved',
      settlementAmount: 5,
    });
    expect(await rebuildProjection(t.db, id)).toEqual(await liveRow(id));
  });

  it('equals the live row for a cancelled errand', async () => {
    const id = await create({ description: undefined });
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

// ADR 0014 follow-up: a reward + supplier edit, and a refused edit putting the local fields back.
describe('chained edit and rollback', () => {
  const pending = () => ({ pendingSupplierId: randomUUID(), pendingDeliveryBuildingId: randomUUID() });
  const confirmed = { supplierEventId: randomUUID(), supplier: {} };

  async function open() {
    const id = await create();
    await step(id, 'Pending-Supplier', 'Reserving-Credit', supplierValidated());
    await step(id, 'Reserving-Credit', 'Open', { payload: creditReserved() });
    const before = await liveRow(id);
    return { id, before };
  }
  const startEditing = (id: string, next = pending()) =>
    step(id, 'Open', 'Editing', {
      actor: user(requester),
      set: { ...next, description: 'changed', deliveryDetail: 'Level 9' },
      payload: { newAmount: 9, expiryDurationMinutes: 600 },
    });
  const restored = async (id: string, before: Awaited<ReturnType<typeof liveRow>>) => {
    const live = await liveRow(id);
    expect(live).toMatchObject({
      status: 'Open',
      description: before.description,
      deliveryDetail: before.deliveryDetail,
      collectionItems: before.collectionItems,
      expiresAt: before.expiresAt,
      rewardCredits: 5,
      supplierId: before.supplierId,
      pendingSupplierId: null,
    });
    expect(await rebuildProjection(t.db, id)).toEqual(live);
  };

  it('switches reward and supplier together once both agree', async () => {
    const { id } = await open();
    const next = pending();
    await startEditing(id, next);
    await step(id, 'Editing', 'Adjusting-Credit', {
      type: 'SupplierConfirmed',
      payload: { ...confirmed, newAmount: 9, apply: {} },
    });
    // Nothing of the supplier has moved while credit decides.
    expect(await liveRow(id)).toMatchObject({ rewardCredits: 5, pendingSupplierId: null });
    await step(id, 'Adjusting-Credit', 'Open', {
      type: 'CreditAdjusted',
      payload: creditIds(),
      set: { rewardCredits: 9, supplierId: next.pendingSupplierId, deliveryBuildingId: next.pendingDeliveryBuildingId, pickupName: 'New Spot' },
    });
    const live = await liveRow(id);
    expect(live).toMatchObject({ status: 'Open', rewardCredits: 9, supplierId: next.pendingSupplierId, pickupName: 'New Spot', description: 'changed' });
    expect(await rebuildProjection(t.db, id)).toEqual(live);
  });

  it('puts the local fields back when the supplier step is refused', async () => {
    const { id, before } = await open();
    await startEditing(id);
    expect(await liveRow(id)).toMatchObject({ description: 'changed', status: 'Editing' });
    await step(id, 'Editing', 'Open', { type: 'EditFailed', payload: { step: 'supplier', supplierEventId: randomUUID(), supplierOutcome: 'INACTIVE' } });
    await restored(id, before);
  });

  it('puts the local fields back when credit refuses after the supplier agreed', async () => {
    const { id, before } = await open();
    await startEditing(id);
    await step(id, 'Editing', 'Adjusting-Credit', { type: 'SupplierConfirmed', payload: { ...confirmed, newAmount: 9, apply: {} } });
    await step(id, 'Adjusting-Credit', 'Open', {
      type: 'CreditAdjustmentFailed',
      payload: { creditEventId: randomUUID(), reason: 'INSUFFICIENT_CREDITS', requestedAmount: 9 },
    });
    await restored(id, before);
  });

  it('does the same for a reward-only edit and a supplier-only edit', async () => {
    const reward = await open();
    await step(reward.id, 'Open', 'Adjusting-Credit', {
      actor: user(requester),
      set: { description: 'changed' },
      payload: { newAmount: 9, expiryDurationMinutes: 600 },
    });
    await step(reward.id, 'Adjusting-Credit', 'Open', {
      type: 'CreditAdjustmentFailed',
      payload: { creditEventId: randomUUID(), reason: 'INSUFFICIENT_CREDITS', requestedAmount: 9 },
    });
    await restored(reward.id, reward.before);

    const supplier = await open();
    await step(supplier.id, 'Open', 'Revalidating-Supplier', {
      actor: user(requester),
      set: { ...pending(), description: 'changed' },
      payload: { expiryDurationMinutes: 600 },
    });
    await step(supplier.id, 'Revalidating-Supplier', 'Open', {
      type: 'SupplierRevalidationFailed',
      payload: { supplierOutcome: 'TIMEOUT' },
    });
    await restored(supplier.id, supplier.before);
  });
});
