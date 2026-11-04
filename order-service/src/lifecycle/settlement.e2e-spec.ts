import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import type { Status } from './status.js';
import { SYSTEM, admin, transition, user } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const requester = randomUUID();
const courier = randomUUID();
const adminId = randomUUID();

async function seed(status: Status) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: requester,
    status,
    courierId: courier,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
  });
  return id;
}
const row = async (id: string) =>
  (await t.db.select().from(errands).where(eq(errands.id, id)))[0];
const outbox = async (id: string) =>
  (await t.db.select().from(outboxEvents)).filter(
    (r) => (r.envelope.payload as { errandId?: string }).errandId === id,
  );
const events = async (id: string) =>
  (await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id))).map((e) => e.type);

const settle = (id: string, actor = admin(adminId), amount = 2) =>
  transition(t.db, {
    errandId: id,
    expected: 'Incomplete',
    to: 'Settling-Credit',
    actor,
    set: { settlementAmount: amount, settlementNote: 'split it' },
  });
const reject = (id: string) =>
  transition(t.db, {
    errandId: id,
    expected: 'Settling-Credit',
    to: 'Incomplete',
    actor: SYSTEM,
    payload: { creditEventId: randomUUID(), reason: 'INSUFFICIENT_FUNDS' },
  });

describe('settlement edges', () => {
  it('lets an admin settle, writing the notice with the transition', async () => {
    const id = await seed('Incomplete');
    expect(await settle(id)).toMatchObject({ ok: true });

    expect(await row(id)).toMatchObject({
      status: 'Settling-Credit',
      settlementAmount: 2,
      settlementNote: 'split it',
    });
    expect(await outbox(id)).toMatchObject([
      {
        routingKey: 'credit.settlement.v1',
        envelope: {
          payload: {
            errandId: id,
            requesterUserId: requester,
            courierUserId: courier,
            courierAmount: 2,
            requesterAmount: 3,
            attempt: 1,
          },
        },
      },
    ]);
  });

  it('refuses anyone who is not an admin, system included', async () => {
    const id = await seed('Incomplete');
    for (const actor of [user(requester), user(courier), user(adminId), SYSTEM]) {
      expect(await settle(id, actor)).toEqual({ ok: false, reason: 'FORBIDDEN' });
    }
    expect((await row(id)).status).toBe('Incomplete');
    expect(await outbox(id)).toHaveLength(0);
  });

  it('refuses an amount above the reward without moving the errand', async () => {
    const id = await seed('Incomplete');
    await expect(settle(id, admin(adminId), 6)).rejects.toThrow();
    expect((await row(id)).status).toBe('Incomplete');
  });

  it('returns to Incomplete on a rejection, clears the settlement and counts attempts', async () => {
    const id = await seed('Incomplete');
    await settle(id);
    expect(await reject(id)).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({
      status: 'Incomplete',
      settlementAmount: null,
      settlementNote: null,
    });

    await settle(id, admin(adminId), 5);
    expect((await outbox(id)).map((r) => (r.envelope.payload as { attempt: number }).attempt)).toEqual([
      1, 2,
    ]);
    expect(await events(id)).toEqual([
      'SettlementRequested',
      'CreditSettlementRejected',
      'SettlementRequested',
    ]);
  });

  it('resolves on credit success, and Resolved is terminal', async () => {
    const id = await seed('Incomplete');
    await settle(id);
    const ok = await transition(t.db, {
      errandId: id,
      expected: 'Settling-Credit',
      to: 'Resolved',
      actor: SYSTEM,
      payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID() },
    });
    expect(ok).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ status: 'Resolved', settlementAmount: 2 });

    for (const to of ['Incomplete', 'Settling-Credit'] as const) {
      expect(
        await transition(t.db, { errandId: id, expected: 'Resolved', to, actor: SYSTEM }),
      ).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
    }
  });

  it('refuses the system edges to users and the wrong source status', async () => {
    const id = await seed('Settling-Credit');
    expect(
      await transition(t.db, {
        errandId: id,
        expected: 'Settling-Credit',
        to: 'Resolved',
        actor: admin(adminId),
        payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID() },
      }),
    ).toEqual({ ok: false, reason: 'FORBIDDEN' });

    const open = await seed('Delivered');
    expect(
      await transition(t.db, {
        errandId: open,
        expected: 'Delivered',
        to: 'Settling-Credit',
        actor: admin(adminId),
        set: { settlementAmount: 1, settlementNote: 'x' },
      }),
    ).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
  });
});
