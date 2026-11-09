import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import type { Status } from './status.js';
import { supplierRevalidationId } from './notice.js';
import { SYSTEM, transition, user } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.db.delete(errandEvents);
  await t.db.delete(errands);
});

const requester = randomUUID();
const courier = randomUUID();

async function seed(status: Status) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: requester,
    status,
    supplierId: randomUUID(),
    courierId: ['Accepted', 'Picked Up', 'Delivered'].includes(status)
      ? courier
      : undefined,
    deliveryLocation: 'COM2',
    deliveryBuildingId: randomUUID(),
    deliveryDetail: 'Level 3 04-02',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
  });
  return id;
}
const outbox = async (id: string) =>
  (await t.db.select().from(outboxEvents)).filter(
    (r) => (r.envelope.payload as { errandId?: string }).errandId === id,
  );

describe('transition notices', () => {
  it('writes ErrandAccepted once with the persisted participants', async () => {
    const id = await seed('Open');
    const input = {
      errandId: id,
      expected: 'Open' as const,
      to: 'Accepted' as const,
      actor: user(courier),
      set: { courierId: courier },
      idempotencyKey: `accept-${id}`,
    };

    expect(await transition(t.db, input)).toMatchObject({ ok: true });
    expect(await outbox(id)).toMatchObject([
      {
        eventType: 'ErrandAccepted',
        routingKey: 'order.errand-accepted.v1',
        envelope: {
          eventType: 'ErrandAccepted',
          publisher: 'order-service',
          payload: {
            errandId: id,
            requesterUserId: requester,
            courierUserId: courier,
          },
        },
      },
    ]);

    expect(await transition(t.db, input)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(await outbox(id)).toHaveLength(1);
  });

  it('writes CourierCancelled with the authorized actor after clearing the projection', async () => {
    const id = await seed('Accepted');
    expect(
      await transition(t.db, {
        errandId: id,
        expected: 'Accepted',
        to: 'Open',
        actor: user(courier.toUpperCase()),
        payload: { reason: 'Cannot continue' },
      }),
    ).toMatchObject({ ok: true });

    const [row] = await t.db.select().from(errands).where(eq(errands.id, id));
    expect(row.courierId).toBeNull();
    expect(await outbox(id)).toMatchObject([
      {
        eventType: 'CourierCancelled',
        routingKey: 'order.courier-cancelled.v1',
        envelope: {
          eventType: 'CourierCancelled',
          publisher: 'order-service',
          payload: {
            errandId: id,
            requesterUserId: requester,
            courierUserId: courier,
          },
        },
      },
    ]);
  });

  it('writes ErrandDelivered with the persisted participants', async () => {
    const id = await seed('Picked Up');
    expect(
      await transition(t.db, {
        errandId: id,
        expected: 'Picked Up',
        to: 'Delivered',
        actor: user(courier),
        set: { deliveredAt: new Date('2030-01-01T00:00:00.000Z') },
      }),
    ).toMatchObject({ ok: true });

    expect(await outbox(id)).toMatchObject([
      {
        eventType: 'ErrandDelivered',
        routingKey: 'order.errand-delivered.v1',
        envelope: {
          eventType: 'ErrandDelivered',
          publisher: 'order-service',
          payload: {
            errandId: id,
            requesterUserId: requester,
            courierUserId: courier,
          },
        },
      },
    ]);
  });

  it('writes no notice when a withdrawal is refused', async () => {
    const id = await seed('Accepted');
    expect(
      await transition(t.db, {
        errandId: id,
        expected: 'Accepted',
        to: 'Open',
        actor: user(randomUUID()),
        payload: { reason: 'Not assigned' },
      }),
    ).toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(await outbox(id)).toHaveLength(0);
  });

  it('rolls back acceptance when the outbox insert fails', async () => {
    const constraint = 'outbox_reject_errand_accepted_test';
    await t.db.execute(
      sql.raw(
        `ALTER TABLE outbox_events ADD CONSTRAINT ${constraint} ` +
          `CHECK (routing_key <> 'order.errand-accepted.v1') NOT VALID`,
      ),
    );

    const id = await seed('Open');
    try {
      await expect(
        transition(t.db, {
          errandId: id,
          expected: 'Open',
          to: 'Accepted',
          actor: user(courier),
          set: { courierId: courier },
        }),
      ).rejects.toThrow();
    } finally {
      await t.db.execute(
        sql.raw(
          `ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS ${constraint}`,
        ),
      );
    }

    const [row] = await t.db.select().from(errands).where(eq(errands.id, id));
    expect(row).toMatchObject({ status: 'Open', courierId: null });
    expect(
      await t.db
        .select()
        .from(errandEvents)
        .where(eq(errandEvents.errandId, id)),
    ).toHaveLength(0);
    expect(await outbox(id)).toHaveLength(0);
  });

  it('writes the notice with the event, and a replay adds none', async () => {
    const id = await seed('Delivered');
    const input = {
      errandId: id,
      expected: 'Delivered' as const,
      to: 'Transferring-Credit' as const,
      actor: SYSTEM,
      idempotencyKey: 'k1',
    };

    expect(await transition(t.db, input)).toMatchObject({ ok: true });
    const rows = await outbox(id);
    expect(rows).toMatchObject([
      {
        routingKey: 'order.errand-completed.v1',
        envelope: {
          payload: {
            errandId: id,
            requesterUserId: requester,
            courierUserId: courier,
            amount: 5,
          },
        },
      },
    ]);

    expect(await transition(t.db, input)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(await outbox(id)).toHaveLength(1);
  });

  it('rolls the state change back when the notice breaks its contract', async () => {
    const id = await seed('Open');
    // A valid payload, but errand data the payload schema cannot see breaks
    // the notice: oldAmount must be >= 1.
    await t.db
      .update(errands)
      .set({ rewardCredits: 0 })
      .where(eq(errands.id, id));
    await expect(
      transition(t.db, {
        errandId: id,
        expected: 'Open',
        to: 'Adjusting-Credit',
        actor: user(requester),
        payload: { newAmount: 9 },
      }),
    ).rejects.toThrow(/failed its contract/);

    const [row] = await t.db.select().from(errands).where(eq(errands.id, id));
    expect(row.status).toBe('Open');
    expect(
      await t.db
        .select()
        .from(errandEvents)
        .where(eq(errandEvents.errandId, id)),
    ).toHaveLength(0);
    expect(await outbox(id)).toHaveLength(0);
  });

  it('emits nothing on a rejection cancel, a release on timeout', async () => {
    const rejected = await seed('Reserving-Credit');
    await transition(t.db, {
      errandId: rejected,
      expected: 'Reserving-Credit',
      to: 'Cancelled',
      actor: SYSTEM,
      payload: { creditEventId: randomUUID(), requestedAmount: 5 },
      set: { cancellationReason: 'INSUFFICIENT_CREDITS' },
    });
    expect(await outbox(rejected)).toHaveLength(0);

    const timedOut = await seed('Reserving-Credit');
    await transition(t.db, {
      errandId: timedOut,
      expected: 'Reserving-Credit',
      to: 'Cancelled',
      actor: SYSTEM,
      set: { cancellationReason: 'CREDIT_TIMEOUT' },
    });
    expect(await outbox(timedOut)).toMatchObject([
      { routingKey: 'order.errand-cancelled.v1' },
    ]);
  });

  it('asks supplier-service about an edited supplier, keeping the old one until it answers (F2.1.1)', async () => {
    const id = await seed('Open');
    const before = (await t.db.select().from(errands).where(eq(errands.id, id)))[0];
    const pendingSupplierId = randomUUID();
    const pendingDeliveryBuildingId = randomUUID();

    const res = await transition(t.db, {
      errandId: id, expected: 'Open', to: 'Revalidating-Supplier', actor: user(requester),
      set: { pendingSupplierId, pendingDeliveryBuildingId, description: 'new spot' },
    });

    expect(res).toEqual({ ok: true, sequenceNumber: 1 });
    expect((await t.db.select().from(errands).where(eq(errands.id, id)))[0]).toMatchObject({
      status: 'Revalidating-Supplier',
      supplierId: before.supplierId,
      deliveryBuildingId: before.deliveryBuildingId,
      pendingSupplierId,
      pendingDeliveryBuildingId,
      description: 'new spot',
    });
    expect(await outbox(id)).toMatchObject([
      {
        eventId: supplierRevalidationId(id, 1, 0),
        routingKey: 'order.supplier-validation-requested.v1',
        envelope: { payload: { errandId: id, supplierId: pendingSupplierId, deliveryBuildingId: pendingDeliveryBuildingId } },
      },
    ]);
  });

  it('refuses a revalidation without both pending ids', async () => {
    const id = await seed('Open');
    expect(
      await transition(t.db, {
        errandId: id, expected: 'Open', to: 'Revalidating-Supplier', actor: user(requester),
        set: { pendingSupplierId: randomUUID() },
      }),
    ).toEqual({ ok: false, reason: 'INVALID_FIELDS' });
    expect(await outbox(id)).toHaveLength(0);
  });
});
