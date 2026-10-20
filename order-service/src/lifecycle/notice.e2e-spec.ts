import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import type { Status } from './status.js';
import { SYSTEM, transition, user } from './transition.js';

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
    courierId: status === 'Delivered' ? courier : undefined,
    deliveryLocation: 'COM2',
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
          payload: { errandId: id, requesterUserId: requester, courierUserId: courier, amount: 5 },
        },
      },
    ]);

    expect(await transition(t.db, input)).toMatchObject({ ok: true, replayed: true });
    expect(await outbox(id)).toHaveLength(1);
  });

  it('rolls the state change back when the notice breaks its contract', async () => {
    const id = await seed('Open');
    // A valid payload, but errand data the payload schema cannot see breaks
    // the notice: oldAmount must be >= 1.
    await t.db.update(errands).set({ rewardCredits: 0 }).where(eq(errands.id, id));
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
    expect(await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id))).toHaveLength(0);
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
    expect(await outbox(timedOut)).toMatchObject([{ routingKey: 'order.errand-cancelled.v1' }]);
  });
});
