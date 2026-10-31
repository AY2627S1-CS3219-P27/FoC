import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
const ago = (h: number) => new Date(Date.now() - h * HOUR);

const seed = async (over: Partial<typeof errands.$inferInsert> = {}) => {
  const row = {
    id: randomUUID(),
    requesterId: randomUUID(),
    courierId: randomUUID(),
    status: 'Incomplete' as Status,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
    ...over,
  };
  await t.db.insert(errands).values(row);
  return row;
};
// When the errand first entered Incomplete: the queue orders by this, not updatedAt.
const disputedAt = (e: { id: string }, at: Date, seq = 1) =>
  t.db.insert(errandEvents).values({
    errandId: e.id,
    sequenceNumber: seq,
    type: 'ErrandIncomplete',
    fromStatus: 'Delivered',
    toStatus: 'Incomplete',
    payload: {},
    occurredAt: at,
  });
const report = (e: { id: string; requesterId: string; courierId: string | null }, role: 'requester' | 'courier') =>
  t.db.insert(disputeReports).values({
    errandId: e.id,
    authorId: role === 'requester' ? e.requesterId : e.courierId!,
    role,
    body: `${role} says`,
  });

const admin = async (path = '', isAdmin = true) =>
  fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${await signAccessToken({ sub: randomUUID(), roles: [], isAdmin })}` },
  });
const queue = async (query = '') => {
  const res = await admin(query ? `?${query}` : '');
  return { res, body: await res.json() };
};
const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

describe('guard', () => {
  it('rejects a missing token and a non-admin on both routes', async () => {
    const id = randomUUID();
    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(`${base}/${id}`)).status).toBe(401);
    expect((await admin('', false)).status).toBe(403);
    expect((await admin(`/${id}`, false)).status).toBe(403);
  });
});

describe('GET /v1/admin/disputes', () => {
  it('lists Incomplete and Settling-Credit errands, longest-disputed first', async () => {
    const newer = await seed();
    const settling = await seed({ status: 'Settling-Credit' });
    const oldest = await seed();
    await disputedAt(newer, ago(1));
    await disputedAt(settling, ago(3));
    await disputedAt(oldest, ago(5));
    for (const status of ['Resolved', 'Open'] as const) await seed({ status });
    const { res, body } = await queue();
    expect(res.status).toBe(200);
    expect(ids(body)).toEqual([oldest.id, settling.id, newer.id]);
    expect(body.items[1]).toMatchObject({ status: 'Incomplete', internalStatus: 'Settling-Credit' });
  });

  it('keeps its place when a rejected settlement bumps updatedAt', async () => {
    const rejected = await seed({ updatedAt: ago(0) });
    const waiting = await seed({ updatedAt: ago(2) });
    await disputedAt(rejected, ago(9));
    await disputedAt(waiting, ago(4));
    expect(ids((await queue()).body)).toEqual([rejected.id, waiting.id]);
  });

  it('shows both parties, the reward and which reports exist', async () => {
    const none = await seed();
    const one = await seed();
    const both = await seed();
    await disputedAt(none, ago(3));
    await disputedAt(one, ago(2));
    await disputedAt(both, ago(1));
    await report(one, 'courier');
    await report(both, 'requester');
    await report(both, 'courier');
    const { body } = await queue();
    expect(body.items).toMatchObject([
      { id: none.id, requesterId: none.requesterId, courierId: none.courierId, rewardCredits: 5, reports: { requester: false, courier: false } },
      { id: one.id, reports: { requester: false, courier: true } },
      { id: both.id, reports: { requester: true, courier: true } },
    ]);
    expect(body.items[0]).not.toHaveProperty('idempotencyKey');
  });

  it('pages with limit and offset', async () => {
    const [a, b, c] = [await seed(), await seed(), await seed()];
    await disputedAt(a, ago(3));
    await disputedAt(b, ago(2));
    await disputedAt(c, ago(1));
    expect(ids((await queue('limit=2')).body)).toEqual([a.id, b.id]);
    const { body } = await queue('limit=2&offset=2');
    expect(ids(body)).toEqual([c.id]);
    expect(body).toMatchObject({ limit: 2, offset: 2 });
    expect((await queue('limit=0')).res.status).toBe(400);
  });

  it('is empty when there are no disputes', async () => {
    expect((await queue()).body).toEqual({ items: [], limit: 20, offset: 0 });
  });
});

describe('GET /v1/admin/disputes/:errandId', () => {
  const event = (errandId: string, sequenceNumber: number, type: string, payload: object, occurredAt: Date) =>
    t.db.insert(errandEvents).values({
      errandId,
      sequenceNumber,
      type,
      fromStatus: 'Settling-Credit',
      toStatus: 'Incomplete',
      payload,
      occurredAt,
    });

  it('returns the errand, both reports and the events in order', async () => {
    const e = await seed({ lastSequenceNumber: 2 });
    await report(e, 'requester');
    await report(e, 'courier');
    await event(e.id, 2, 'ErrandIncomplete', {}, ago(1));
    await event(e.id, 1, 'ErrandDelivered', {}, ago(2));
    const res = await admin(`/${e.id}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.errand).toMatchObject({ id: e.id, internalStatus: 'Incomplete', requesterId: e.requesterId });
    expect(body.reports).toMatchObject([
      { role: 'requester', authorId: e.requesterId, body: 'requester says' },
      { role: 'courier', authorId: e.courierId, body: 'courier says' },
    ]);
    expect(body.events.map((x: { sequenceNumber: number }) => x.sequenceNumber)).toEqual([1, 2]);
    expect(body.latestRejection).toBeNull();
  });

  it('returns zero reports as an empty list and the latest rejection with its reason', async () => {
    const e = await seed({ lastSequenceNumber: 2 });
    await event(e.id, 1, 'CreditSettlementRejected', { reason: 'OLD' }, ago(3));
    await event(e.id, 2, 'CreditSettlementRejected', { reason: 'INSUFFICIENT_HELD' }, ago(1));
    const body = await (await admin(`/${e.id}`)).json();
    expect(body.reports).toEqual([]);
    expect(body.latestRejection).toMatchObject({ sequenceNumber: 2, payload: { reason: 'INSUFFICIENT_HELD' } });
  });

  it('returns only the allowlisted fields of events, reports and the latest rejection', async () => {
    const e = await seed({ lastSequenceNumber: 1 });
    await report(e, 'requester');
    await event(e.id, 1, 'CreditSettlementRejected', { reason: 'X' }, ago(1));
    const body = await (await admin(`/${e.id}`)).json();
    const eventKeys = ['actorId', 'fromStatus', 'occurredAt', 'payload', 'sequenceNumber', 'toStatus', 'type'];
    expect(Object.keys(body.events[0]).sort()).toEqual(eventKeys);
    expect(Object.keys(body.latestRejection).sort()).toEqual(eventKeys);
    expect(Object.keys(body.reports[0]).sort()).toEqual(['authorId', 'body', 'createdAt', 'role']);
  });

  it('serves a Settling-Credit errand, reported as Incomplete with its internal status', async () => {
    const settling = await seed({ status: 'Settling-Credit' });
    const res = await admin(`/${settling.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).errand).toMatchObject({ status: 'Incomplete', internalStatus: 'Settling-Credit' });
  });

  it('is a 404 for an unknown id and for an errand that is not in dispute', async () => {
    const resolved = await seed({ status: 'Resolved' });
    expect((await admin(`/${randomUUID()}`)).status).toBe(404);
    expect((await admin(`/${resolved.id}`)).status).toBe(404);
  });

  it('is a 400 for a malformed id', async () => {
    expect((await admin('/nope')).status).toBe(400);
  });
});
