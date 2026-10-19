import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import { Role } from '@foc/contracts';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signAccessToken, testKeys } from '../../test/access-token.js';
import { createTestDb } from '../../test/db.js';
import { DB } from '../db/db.module.js';
import { errands } from '../db/schema.js';
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
  base = `${await app.getUrl()}/v1/errands`;
});
afterAll(async () => {
  await app.close();
  await t.close();
});
beforeEach(() => t.db.delete(errands));

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

// One errand row, Open and unexpired unless overridden.
const seed = async (over: Partial<typeof errands.$inferInsert> = {}) => {
  const row = {
    id: randomUUID(),
    requesterId: randomUUID(),
    status: 'Open' as Status,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    pickupLocation: 'UTown',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
    expiresAt: inHours(2),
    ...over,
  };
  await t.db.insert(errands).values(row);
  return row;
};

const courier = randomUUID();
const get = async (path = '', roles = [Role.Courier], sub = courier) =>
  fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${await signAccessToken({ sub, roles })}` },
  });
const list = async (query = '') => {
  const res = await get(query ? `?${query}` : '');
  return { res, body: await res.json() };
};
const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

describe('GET /v1/errands', () => {
  it('rejects a missing token and a non-courier', async () => {
    expect((await fetch(base)).status).toBe(401);
    expect((await get('', [Role.Requester])).status).toBe(403);
  });

  it('lists Open errands with a public allowlist of fields and the page window', async () => {
    const e = await seed({ description: 'leave at door' });
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      items: [
        {
          id: e.id,
          status: 'Open',
          supplierId: e.supplierId,
          pickupLocation: 'UTown',
          deliveryLocation: 'COM2',
          collectionItems: 'bubble tea',
          description: 'leave at door',
          rewardCredits: 5,
          expiresAt: e.expiresAt!.toISOString(),
          createdAt: expect.any(String),
        },
      ],
      limit: 20,
      offset: 0,
    });
  });

  it('shows Adjusting-Credit as Open', async () => {
    await seed({ status: 'Adjusting-Credit' });
    const { body } = await list();
    expect(body.items.map((i: { status: string }) => i.status)).toEqual(['Open']);
  });

  it('leaves out other statuses, expired, never-opened and own errands', async () => {
    const shown = await seed();
    for (const status of ['Pending-Supplier', 'Reserving-Credit', 'Accepted', 'Completed', 'Cancelled'] as const) {
      await seed({ status, expiresAt: inHours(2) });
    }
    await seed({ expiresAt: inHours(-1) });
    await seed({ expiresAt: null });
    await seed({ requesterId: courier });
    expect(ids((await list()).body)).toEqual([shown.id]);
  });

  describe('sort', () => {
    it('defaults to soonest expiry', async () => {
      const late = await seed({ expiresAt: inHours(5) });
      const soon = await seed({ expiresAt: inHours(1) });
      expect(ids((await list()).body)).toEqual([soon.id, late.id]);
    });

    it('sorts newest first', async () => {
      const old = await seed({ createdAt: inHours(-5) });
      const recent = await seed({ createdAt: inHours(-1) });
      expect(ids((await list('sort=newest')).body)).toEqual([recent.id, old.id]);
    });

    it('sorts highest credits first', async () => {
      const low = await seed({ rewardCredits: 2 });
      const high = await seed({ rewardCredits: 9 });
      expect(ids((await list('sort=credits')).body)).toEqual([high.id, low.id]);
    });

    it('breaks ties by id', async () => {
      const at = inHours(3);
      const rows = [await seed({ expiresAt: at }), await seed({ expiresAt: at }), await seed({ expiresAt: at })];
      const expected = rows.map((r) => r.id).sort();
      expect(ids((await list()).body)).toEqual(expected);
    });
  });

  describe('filters', () => {
    it('matches pickupBuilding and deliveryBuilding case-insensitively and exactly', async () => {
      const hit = await seed({ pickupLocation: 'UTown', deliveryLocation: 'COM2' });
      await seed({ pickupLocation: 'UTown Annex', deliveryLocation: 'COM2' });
      await seed({ pickupLocation: null, deliveryLocation: 'COM2' });
      await seed({ pickupLocation: 'UTown', deliveryLocation: 'SOC' });
      expect(ids((await list('pickupBuilding=utown&deliveryBuilding=com2')).body)).toEqual([hit.id]);
    });

    it('applies minCredits inclusively', async () => {
      await seed({ rewardCredits: 4 });
      const five = await seed({ rewardCredits: 5 });
      expect(ids((await list('minCredits=5')).body)).toEqual([five.id]);
    });
  });

  describe('paging', () => {
    it('windows with limit and offset and echoes them', async () => {
      const rows = [];
      for (let h = 1; h <= 3; h++) rows.push(await seed({ expiresAt: inHours(h) }));
      const { body } = await list('limit=1&offset=1');
      expect(body).toMatchObject({ limit: 1, offset: 1 });
      expect(ids(body)).toEqual([rows[1]!.id]);
    });
  });

  describe('bad query values are a 400', () => {
    it.each([
      'sort=oldest',
      'limit=0',
      'limit=51',
      'limit=abc',
      'offset=-1',
      'minCredits=0',
      'minCredits=1.5',
      'pickupBuilding=',
      'limit=1&limit=2',
    ])('%s', async (query) => {
      expect((await list(query)).res.status).toBe(400);
    });
  });
});
