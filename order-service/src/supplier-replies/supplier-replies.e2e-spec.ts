import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { deliveryBuilding, supplierSnapshot } from '../../test/payloads.js';
import { CreditReplyHandler } from '../credit-replies/credit-reply.handler.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import { createErrand } from '../lifecycle/create.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { rebuildProjection } from '../lifecycle/rebuild.js';
import { SYSTEM, transition } from '../lifecycle/transition.js';
import { SUPPLIER_REPLY_SPECS } from './supplier-replies.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
let lifecycle: LifecycleService;
beforeAll(async () => {
  t = await createTestDb();
  lifecycle = new LifecycleService(t.db);
});
afterAll(() => t.close());

const contracts = new AccountEventContractValidator();
const timestamp = '2030-01-01T00:00:00.000Z';

async function create() {
  const supplierId = randomUUID();
  const res = await createErrand(t.db, {
    requesterId: randomUUID(),
    supplierId,
    deliveryBuildingId: randomUUID(),
    deliveryDetail: 'Level 3 04-02',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
  });
  if (!res.ok) throw new Error(res.reason);
  return { id: res.errandId, supplierId };
}

function deliver(payload: object, eventId = randomUUID()) {
  const body = {
    eventId,
    eventType: 'SupplierValidationCompleted',
    timestamp,
    publisher: 'supplier-service',
    payload,
  };
  return new CreditReplyHandler(SUPPLIER_REPLY_SPECS[0], lifecycle, contracts).handle({
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    routingKey: 'supplier.validation-completed.v1',
    eventId,
    retryCount: 0,
  });
}

const row = async (id: string) =>
  (await t.db.select().from(errands).where(eq(errands.id, id)))[0];
const events = (id: string) =>
  t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id));
const outbox = async (id: string) =>
  (await t.db.select().from(outboxEvents).where(sql`envelope->'payload'->>'errandId' = ${id}`)).map(
    (r) => r.routingKey,
  );

describe('supplier validation reply against the database', () => {
  it('dead-letters a reply for another supplier and leaves the errand pending', async () => {
    const { id } = await create();
    const res = await deliver({ errandId: id, supplierId: randomUUID(), outcome: 'NOT_FOUND' });
    expect(res).toMatchObject({ outcome: 'dead-letter', category: 'INVALID_PAYLOAD' });
    expect((await row(id))!.status).toBe('Pending-Supplier');
  });

  it('moves an Active supplier on to the credit reservation, once', async () => {
    const { id, supplierId } = await create();
    const eventId = randomUUID();
    const reply = { errandId: id, supplierId, outcome: 'FOUND', supplier: supplierSnapshot, deliveryBuilding };

    expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' });
    expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' }); // redelivery

    expect(await row(id)).toMatchObject({
      status: 'Reserving-Credit',
      supplierValidatedAt: new Date(timestamp),
      pickupName: 'Cool Spot @ COM2',
      pickupLocation: 'COM2',
      pickupDescription: 'Floor 1 · Next to LT19',
      deliveryLocation: 'COM2',
      deliveryVenue: 'Around COM2',
      deliveryLatitude: 1.2939,
      deliveryLongitude: 103.7742,
    });
    const evs = await events(id);
    expect(evs).toHaveLength(2);
    expect(evs.find((e) => e.sequenceNumber === 2)).toMatchObject({
      type: 'SupplierValidated',
      actorId: null,
      payload: { supplierEventId: eventId, supplier: supplierSnapshot },
    });
    expect((await outbox(id)).sort()).toEqual([
      'credit.reservation.v1',
      'order.supplier-validation-requested.v1',
    ]);

    const live = await row(id);
    const { idempotencyKey: _k, createdAt: _c, updatedAt: _u, ...expected } = live;
    expect(await rebuildProjection(t.db, id)).toEqual(expected);
  });

  it('cancels a missing supplier with SUPPLIER_UNAVAILABLE and asks credit for nothing', async () => {
    const { id, supplierId } = await create();
    await deliver({ errandId: id, supplierId, outcome: 'NOT_FOUND' });

    expect(await row(id)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'SUPPLIER_UNAVAILABLE',
      supplierValidatedAt: null,
    });
    expect(await outbox(id)).toEqual(['order.supplier-validation-requested.v1']);
  });

  it('cancels a missing delivery building with BUILDING_UNAVAILABLE and asks credit for nothing', async () => {
    const { id, supplierId } = await create();
    const eventId = randomUUID();
    await deliver({ errandId: id, supplierId, outcome: 'BUILDING_NOT_FOUND' }, eventId);

    expect(await row(id)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'BUILDING_UNAVAILABLE',
      supplierValidatedAt: null,
      deliveryLocation: null,
    });
    expect((await events(id)).find((e) => e.sequenceNumber === 2)).toMatchObject({
      payload: { supplierEventId: eventId, supplierOutcome: 'BUILDING_NOT_FOUND' },
    });
    expect(await outbox(id)).toEqual(['order.supplier-validation-requested.v1']);
  });

  it('cancels a missing venue with VENUE_UNAVAILABLE and asks credit for nothing', async () => {
    const { id, supplierId } = await create();
    const eventId = randomUUID();
    await deliver({ errandId: id, supplierId, outcome: 'VENUE_NOT_FOUND' }, eventId);

    expect(await row(id)).toMatchObject({ status: 'Cancelled', cancellationReason: 'VENUE_UNAVAILABLE', deliveryVenue: null });
    expect((await events(id)).find((e) => e.sequenceNumber === 2)).toMatchObject({
      payload: { supplierEventId: eventId, supplierOutcome: 'VENUE_NOT_FOUND' },
    });
    expect(await outbox(id)).toEqual(['order.supplier-validation-requested.v1']);
  });

  it('keeps a pin and labels it Requester Delivery Location', async () => {
    const supplierId = randomUUID();
    const res = await createErrand(t.db, {
      requesterId: randomUUID(), supplierId, deliveryBuildingId: randomUUID(), deliveryDetail: 'by the bench',
      deliveryPin: { latitude: 1.3, longitude: 103.77 }, rewardCredits: 5, expiryDurationMinutes: 60, collectionItems: 'tea',
    });
    if (!res.ok) throw new Error(res.reason);
    await deliver({ errandId: res.errandId, supplierId, outcome: 'FOUND', supplier: supplierSnapshot, deliveryBuilding });
    expect(await row(res.errandId)).toMatchObject({
      deliveryVenue: 'Requester Delivery Location', deliveryLatitude: 1.3, deliveryLongitude: 103.77,
    });
  });

  it('acks a reply that arrives after the errand was cancelled, changing nothing', async () => {
    const { id, supplierId } = await create();
    await transition(t.db, {
      errandId: id,
      expected: 'Pending-Supplier',
      to: 'Cancelled',
      actor: SYSTEM,
      set: { cancellationReason: 'SUPPLIER_VALIDATION_TIMEOUT' },
    });

    const res = await deliver({ errandId: id, supplierId, outcome: 'FOUND', supplier: supplierSnapshot, deliveryBuilding });
    expect(res).toEqual({ outcome: 'ack' });
    expect(await row(id)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'SUPPLIER_VALIDATION_TIMEOUT',
    });
    expect(await events(id)).toHaveLength(2);
  });

  describe('re-checking an edited supplier (F2.1.1)', () => {
    // Open errand with a pending change to a new supplier and building.
    async function revalidating() {
      const { id, supplierId: oldSupplier } = await create();
      await transition(t.db, {
        errandId: id, expected: 'Pending-Supplier', to: 'Reserving-Credit', actor: SYSTEM,
        set: { supplierValidatedAt: new Date(timestamp), pickupName: 'Old Spot', pickupLocation: 'AS6', pickupDescription: 'x', deliveryLocation: 'AS6', deliveryVenue: 'Around AS6', deliveryLatitude: 1.29, deliveryLongitude: 103.77 },
        payload: { supplierEventId: randomUUID(), supplier: supplierSnapshot },
      });
      await transition(t.db, {
        errandId: id, expected: 'Reserving-Credit', to: 'Open', actor: SYSTEM,
        payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID(), reservedAmount: 5 },
      });
      const supplierId = randomUUID();
      const requester = (await row(id))!.requesterId;
      const res = await lifecycle.transition({
        errandId: id, expected: 'Open', to: 'Revalidating-Supplier', actor: { kind: 'user', id: requester },
        set: { pendingSupplierId: supplierId, pendingDeliveryBuildingId: deliveryBuilding.id },
      });
      if (!res.ok) throw new Error(res.reason);
      return { id, oldSupplier, supplierId };
    }

    it('switches the errand to the new supplier once, and the log rebuilds it', async () => {
      const { id, supplierId } = await revalidating();
      const eventId = randomUUID();
      const reply = { errandId: id, supplierId, outcome: 'FOUND', supplier: supplierSnapshot, deliveryBuilding };
      expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' });
      expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' }); // redelivery

      const live = await row(id);
      expect(live).toMatchObject({
        status: 'Open',
        supplierId,
        deliveryBuildingId: deliveryBuilding.id,
        pickupName: 'Cool Spot @ COM2',
        pendingSupplierId: null,
        pendingDeliveryBuildingId: null,
      });
      expect((await events(id)).map((e) => e.type)).toEqual([
        'ErrandCreated', 'SupplierValidated', 'CreditReserved', 'SupplierRevalidationRequested', 'SupplierRevalidated',
      ]);
      const { idempotencyKey: _, createdAt: __, updatedAt: ___, ...projection } = live!;
      expect(await rebuildProjection(t.db, id)).toEqual(projection);
    });

    it('keeps the old supplier when the new one is inactive', async () => {
      const { id, oldSupplier, supplierId } = await revalidating();
      const res = await deliver({ errandId: id, supplierId, outcome: 'FOUND', supplier: { ...supplierSnapshot, status: 'Inactive' }, deliveryBuilding });
      expect(res).toEqual({ outcome: 'ack' });
      expect(await row(id)).toMatchObject({ status: 'Open', supplierId: oldSupplier, pickupName: 'Old Spot', pendingSupplierId: null });
      expect((await events(id)).at(-1)).toMatchObject({ type: 'SupplierRevalidationFailed', payload: { supplierOutcome: 'INACTIVE' } });
    });

    it('acks a stale reply about the old supplier without touching the errand', async () => {
      const { id, oldSupplier } = await revalidating();
      const res = await deliver({ errandId: id, supplierId: oldSupplier, outcome: 'FOUND', supplier: supplierSnapshot, deliveryBuilding });
      expect(res).toEqual({ outcome: 'ack' });
      expect((await row(id))!.status).toBe('Revalidating-Supplier');
    });
  });
});
