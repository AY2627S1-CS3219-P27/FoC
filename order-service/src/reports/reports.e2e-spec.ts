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
import { ReportsModule } from './reports.module.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  t = await createTestDb();
  @Global()
  @Module({ providers: [{ provide: DB, useValue: t.db }], exports: [DB] })
  class TestDbModule {}
  const module = await Test.createTestingModule({
    imports: [FocAuthModule.register({ publicKey: testKeys.publicKey }), TestDbModule, ReportsModule],
  }).compile();
  app = module.createNestApplication();
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/v1/errands`;
});
afterAll(async () => {
  await app.close();
  await t.close();
});

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

const report = async (errandId: string, sub: string, body: unknown = { body: 'It was cold.' }) =>
  fetch(`${base}/${errandId}/report`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await signAccessToken({ sub })}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /v1/errands/:id/report', () => {
  it('lets each party file once and stores the author role', async () => {
    const e = await seed();
    expect((await report(e.id, e.requesterId)).status).toBe(201);
    expect((await report(e.id, e.courierId)).status).toBe(201);
    const rows = await t.db.select().from(disputeReports);
    expect(rows.filter((r) => r.errandId === e.id).map((r) => r.role).sort()).toEqual(['courier', 'requester']);
  });

  it('writes no event', async () => {
    const e = await seed();
    await report(e.id, e.requesterId);
    expect(await t.db.select().from(errandEvents)).toEqual([]);
  });

  it('refuses a second report from the same party, keeping the first', async () => {
    const e = await seed();
    await report(e.id, e.requesterId, { body: 'first' });
    const res = await report(e.id, e.requesterId, { body: 'second' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_REPORTED');
    const kept = (await t.db.select().from(disputeReports)).filter((r) => r.errandId === e.id);
    expect(kept.map((r) => r.body)).toEqual(['first']);
  });

  it('is a 404 for a non-party and an unknown errand', async () => {
    const e = await seed();
    expect((await report(e.id, randomUUID())).status).toBe(404);
    expect((await report(randomUUID(), e.requesterId)).status).toBe(404);
  });

  it('is a 409 when the errand is not Incomplete', async () => {
    const e = await seed('Completed');
    const res = await report(e.id, e.requesterId);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_INCOMPLETE');
  });

  it('is a 409 once settlement was requested, even after a rejection back to Incomplete', async () => {
    const e = await seed();
    await t.db.insert(errandEvents).values({
      errandId: e.id,
      sequenceNumber: 1,
      type: 'SettlementRequested',
      fromStatus: 'Incomplete',
      toStatus: 'Settling-Credit',
      payload: {},
    });
    const res = await report(e.id, e.requesterId);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SETTLEMENT_REQUESTED');
  });

  it('enforces the 2,000 character cap and a non-blank body', async () => {
    const e = await seed();
    expect((await report(e.id, e.requesterId, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await report(e.id, e.requesterId, { body: '   ' })).status).toBe(400);
    expect((await report(e.id, e.requesterId, {})).status).toBe(400);
    expect((await report(e.id, e.requesterId, { body: 'x'.repeat(2000) })).status).toBe(201);
  });

  it('rejects a missing token', async () => {
    const res = await fetch(`${base}/${randomUUID()}/report`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
