import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { signAccessToken, testKeys } from '../../test/access-token.js';
import { createTestDb } from '../../test/db.js';
import { DB } from '../db/db.module.js';
import { disputeReports, errandEvents, errands } from '../db/schema.js';
import { configureHttp } from '../http/configure-http.js';
import type { Status } from '../lifecycle/status.js';
import { ErrandsModule } from './errands.module.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  t = await createTestDb();
  @Global()
  @Module({ providers: [{ provide: DB, useValue: t.db }], exports: [DB] })
  class TestDbModule {}
  const module = await Test.createTestingModule({
    imports: [FocAuthModule.register({ publicKey: testKeys.publicKey }), TestDbModule, ErrandsModule],
  }).compile();
  app = module.createNestApplication();
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/v1/admin/disputes`;
});
afterAll(async () => {
  await app.close();
  await t.close();
});
beforeEach(async () => {
  await t.db.delete(disputeReports);
  await t.db.delete(errandEvents);
  await t.db.delete(errands);
});

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

const seed = async (status: Status = 'Incomplete') => {
  const row = {
    id: randomUUID(),
    requesterId: randomUUID(),
    courierId: randomUUID(),
    status,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
  };
  await t.db.insert(errands).values(row);
  return row;
};
// A past rejection, with the request before it, as a retry would have left them.
const rejected = async (id: string, seq: number, at: Date) => {
  await t.db.insert(errandEvents).values({
    errandId: id,
    sequenceNumber: seq,
    type: 'CreditSettlementRejected',
    fromStatus: 'Settling-Credit',
    toStatus: 'Incomplete',
    payload: {},
    occurredAt: at,
  });
  await t.db.update(errands).set({ lastSequenceNumber: seq }).where(eq(errands.id, id));
};

const resolve = async (id: string, body: unknown = { settlementAmount: 2, note: 'split it' }, isAdmin = true) =>
  fetch(`${base}/${id}/resolve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await signAccessToken({ sub: randomUUID(), roles: [], isAdmin })}`,
    },
    body: JSON.stringify(body),
  });
const row = async (id: string) => (await t.db.select().from(errands).where(eq(errands.id, id)))[0];

describe('POST /v1/admin/disputes/:errandId/resolve', () => {
  it('rejects a missing token and a non-admin', async () => {
    const e = await seed();
    expect((await fetch(`${base}/${e.id}/resolve`, { method: 'POST' })).status).toBe(401);
    expect((await resolve(e.id, undefined, false)).status).toBe(403);
  });

  it.each([0, 2, 5])('settles with no reports for amount %i, storing the note on the event and column', async (amount) => {
    const e = await seed();
    const res = await resolve(e.id, { settlementAmount: amount, note: 'because' });
    expect(res.status).toBe(200);
    expect(await row(e.id)).toMatchObject({ status: 'Settling-Credit', settlementAmount: amount, settlementNote: 'because' });
    const [ev] = await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, e.id));
    expect(ev).toMatchObject({ type: 'SettlementRequested', payload: { settlementAmount: amount, settlementNote: 'because' } });
  });

  it.each(['requester', 'courier'] as const)('settles with only the %s report', async (role) => {
    const e = await seed();
    await t.db.insert(disputeReports).values({
      errandId: e.id,
      authorId: role === 'requester' ? e.requesterId : e.courierId,
      role,
      body: 'my side',
    });
    expect((await resolve(e.id)).status).toBe(200);
  });

  it('settles with both reports', async () => {
    const e = await seed();
    await t.db.insert(disputeReports).values([
      { errandId: e.id, authorId: e.requesterId, role: 'requester', body: 'a' },
      { errandId: e.id, authorId: e.courierId, role: 'courier', body: 'b' },
    ]);
    expect((await resolve(e.id)).status).toBe(200);
  });

  it.each([
    ['a fractional amount', { settlementAmount: 1.5, note: 'x' }],
    ['a negative amount', { settlementAmount: -1, note: 'x' }],
    ['an amount above the reward', { settlementAmount: 6, note: 'x' }],
    ['a string amount', { settlementAmount: '2', note: 'x' }],
    ['a missing amount', { note: 'x' }],
    ['a missing note', { settlementAmount: 2 }],
    ['a blank note', { settlementAmount: 2, note: '   ' }],
    ['a note over 100 words', { settlementAmount: 2, note: Array(101).fill('w').join(' ') }],
  ])('400s on %s and changes nothing', async (_, body) => {
    const e = await seed();
    expect((await resolve(e.id, body)).status).toBe(400);
    expect((await row(e.id)).status).toBe('Incomplete');
  });

  it('404s on an unknown errand and 400s on a malformed id', async () => {
    expect((await resolve(randomUUID())).status).toBe(404);
    expect((await resolve('nope')).status).toBe(400);
  });

  it.each(['Open', 'Settling-Credit', 'Resolved'] as const)('409s on a %s errand', async (status) => {
    const e = await seed(status);
    expect((await resolve(e.id)).status).toBe(409);
  });

  it('lets exactly one of two concurrent resolves win, the other 409', async () => {
    const e = await seed();
    const codes = (await Promise.all([resolve(e.id), resolve(e.id)])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const events = await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, e.id));
    expect(events).toHaveLength(1);
  });

  it('429s on the fourth attempt in the hour, and allows it once the oldest rejection is over an hour old', async () => {
    const e = await seed();
    await rejected(e.id, 1, ago(HOUR - 60_000));
    await rejected(e.id, 2, ago(30 * 60_000));
    await rejected(e.id, 3, ago(10 * 60_000));
    expect((await resolve(e.id)).status).toBe(429);
    expect((await row(e.id)).status).toBe('Incomplete');

    await t.db.update(errandEvents).set({ occurredAt: ago(HOUR + 60_000) }).where(eq(errandEvents.sequenceNumber, 1));
    expect((await resolve(e.id)).status).toBe(200);
  });

  it('allows a retry after fewer than 3 rejections', async () => {
    const e = await seed();
    await rejected(e.id, 1, ago(60_000));
    await rejected(e.id, 2, ago(30_000));
    expect((await resolve(e.id)).status).toBe(200);
  });
});
