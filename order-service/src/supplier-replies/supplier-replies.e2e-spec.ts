import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { supplierSnapshot } from '../../test/payloads.js';
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
    deliveryLocation: 'COM2',
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
    const reply = { errandId: id, supplierId, outcome: 'FOUND', supplier: supplierSnapshot };

    expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' });
    expect(await deliver(reply, eventId)).toEqual({ outcome: 'ack' }); // redelivery

    expect(await row(id)).toMatchObject({
      status: 'Reserving-Credit',
      supplierValidatedAt: new Date(timestamp),
      pickupName: 'Cool Spot @ COM2',
      pickupLocation: 'COM2',
      pickupDescription: 'Floor 1 · Next to LT19',
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

  it('acks a reply that arrives after the errand was cancelled, changing nothing', async () => {
    const { id, supplierId } = await create();
    await transition(t.db, {
      errandId: id,
      expected: 'Pending-Supplier',
      to: 'Cancelled',
      actor: SYSTEM,
      set: { cancellationReason: 'SUPPLIER_VALIDATION_TIMEOUT' },
    });

    const res = await deliver({ errandId: id, supplierId, outcome: 'FOUND', supplier: supplierSnapshot });
    expect(res).toEqual({ outcome: 'ack' });
    expect(await row(id)).toMatchObject({
      status: 'Cancelled',
      cancellationReason: 'SUPPLIER_VALIDATION_TIMEOUT',
    });
    expect(await events(id)).toHaveLength(2);
  });
});
