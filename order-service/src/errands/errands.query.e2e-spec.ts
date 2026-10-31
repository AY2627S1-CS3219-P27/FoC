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
    pickupName: 'Cool Spot @ UTown',
    pickupDescription: 'Floor 1 · Next to LT19',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
    expiresAt: inHours(2),
    ...over,
  };
  await t.db.insert(errands).values(row);
  return row;
};

const courier = randomUUID();
const get = async (path = '', roles = [Role.Courier], sub: string = courier) =>
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
          pickupName: 'Cool Spot @ UTown',
          pickupDescription: 'Floor 1 · Next to LT19',
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

describe('GET /v1/errands/mine', () => {
  const me = randomUUID();
  const mine = async (query = '', roles = [Role.Requester]) => {
    const res = await get(`/mine${query ? `?${query}` : ''}`, roles, me);
    return { res, body: await res.json() };
  };

  it('rejects a missing token', async () => {
    expect((await fetch(`${base}/mine`)).status).toBe(401);
  });

  it('rejects a token with no participant role', async () => {
    expect((await get('/mine', [], me)).status).toBe(403);
  });

  it('returns errands where the caller is requester or courier, newest first, in any status', async () => {
    const asRequester = await seed({ requesterId: me, status: 'Pending-Supplier', createdAt: inHours(-3) });
    const asCourier = await seed({ courierId: me, status: 'Accepted', createdAt: inHours(-1) });
    await seed({ createdAt: inHours(-2) });
    const { res, body } = await mine('', [Role.Courier]);
    expect(res.status).toBe(200);
    expect(ids(body)).toEqual([asCourier.id, asRequester.id]);
    expect(body.items.map((i: { status: string }) => i.status)).toEqual(['Accepted', 'Pending']);
    expect(body).toMatchObject({ limit: 20, offset: 0 });
  });

  it('filters by API status, Pending matching both sub-states', async () => {
    const a = await seed({ requesterId: me, status: 'Pending-Supplier' });
    const b = await seed({ requesterId: me, status: 'Reserving-Credit' });
    await seed({ requesterId: me, status: 'Open' });
    expect(new Set(ids((await mine('status=Pending')).body))).toEqual(new Set([a.id, b.id]));
  });

  it('narrows to one side with role, combined with status', async () => {
    const asRequester = await seed({ requesterId: me, status: 'Open' });
    const asCourier = await seed({ courierId: me, status: 'Accepted' });
    const doneAsCourier = await seed({ courierId: me, status: 'Completed' });
    expect(ids((await mine('role=requester')).body)).toEqual([asRequester.id]);
    expect(new Set(ids((await mine('role=courier')).body))).toEqual(
      new Set([asCourier.id, doneAsCourier.id]),
    );
    expect(ids((await mine('role=courier&status=Accepted')).body)).toEqual([asCourier.id]);
  });

  it('pages', async () => {
    const rows = [];
    for (let h = 3; h >= 1; h--) rows.push(await seed({ requesterId: me, createdAt: inHours(-h) }));
    expect(ids((await mine('limit=1&offset=1')).body)).toEqual([rows[1]!.id]);
  });

  it.each(['status=Pending-Supplier', 'status=Adjusting-Credit', 'status=nope', 'limit=0', 'role=admin', 'role='])(
    '%s is a 400',
    async (query) => {
      expect((await mine(query)).res.status).toBe(400);
    },
  );
});

describe('GET /v1/errands/:id', () => {
  const detail = async (id: string, sub: string, roles = [Role.Requester]) => {
    const res = await get(`/${id}`, roles, sub);
    return { res, body: await res.json() };
  };

  it('rejects a missing token and a malformed id', async () => {
    expect((await fetch(`${base}/${randomUUID()}`)).status).toBe(401);
    expect((await detail('nope', courier)).res.status).toBe(400);
  });

  it('rejects a token with no participant role', async () => {
    const e = await seed();
    expect((await detail(e.id, courier, [])).res.status).toBe(403);
  });

  it('shows the requester and courier ids to the requester', async () => {
    const e = await seed({ status: 'Accepted', courierId: randomUUID() });
    const { res, body } = await detail(e.id, e.requesterId);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: e.id, status: 'Accepted', requesterId: e.requesterId, courierId: e.courierId });
  });

  it('shows the cancellation reason to a party, never on the list', async () => {
    const e = await seed({ status: 'Cancelled', cancellationReason: 'REQUESTER_CANCELLED' });
    expect((await detail(e.id, e.requesterId)).body.cancellationReason).toBe('REQUESTER_CANCELLED');
    const mine = await (await get('/mine', [Role.Requester], e.requesterId)).json();
    expect(mine.items[0].cancellationReason).toBe('REQUESTER_CANCELLED');
    const open = await seed();
    expect((await list()).body.items[0]).not.toHaveProperty('cancellationReason');
    expect((await detail(open.id, courier, [Role.Courier])).body).not.toHaveProperty('cancellationReason');
  });

  it('shows the ids to the assigned courier', async () => {
    const e = await seed({ status: 'Accepted', courierId: courier });
    const { body } = await detail(e.id, courier, [Role.Courier]);
    expect(body).toMatchObject({ requesterId: e.requesterId, courierId: courier });
  });

  it('shows an Open errand to any caller without the party ids, Adjusting-Credit as Open', async () => {
    const open = await seed();
    const adjusting = await seed({ status: 'Adjusting-Credit' });
    const a = await detail(open.id, courier, [Role.Courier]);
    expect(a.res.status).toBe(200);
    expect(a.body).not.toHaveProperty('requesterId');
    expect(a.body).not.toHaveProperty('courierId');
    expect(a.body).not.toHaveProperty('idempotencyKey');
    expect((await detail(adjusting.id, courier, [Role.Courier])).body.status).toBe('Open');
  });

  it('hides an expired Open errand from non-parties but not from its requester', async () => {
    const e = await seed({ expiresAt: inHours(-1) });
    expect((await detail(e.id, courier, [Role.Courier])).res.status).toBe(404);
    const { res, body } = await detail(e.id, e.requesterId);
    expect(res.status).toBe(200);
    expect(body.expiresAt).toBe(e.expiresAt!.toISOString());
  });

  it('is a 404 for a non-party on a non-Open errand, and for an unknown id', async () => {
    const e = await seed({ status: 'Accepted', courierId: randomUUID() });
    expect((await detail(e.id, courier, [Role.Courier])).res.status).toBe(404);
    expect((await detail(randomUUID(), courier)).res.status).toBe(404);
  });

  it('maps Transferring-Credit to Completed', async () => {
    const e = await seed({ status: 'Transferring-Credit', courierId: courier });
    expect((await detail(e.id, courier, [Role.Courier])).body.status).toBe('Completed');
  });
});

describe('settlement visibility', () => {
  const settled = { settlementAmount: 3, settlementNote: 'Split it' };
  const view = async (id: string, sub: string, roles = [Role.Requester]) =>
    (await get(`/${id}`, roles, sub)).json();

  it('shows the amount and note to both parties on a Resolved errand, detail and /mine', async () => {
    const e = await seed({ status: 'Resolved', courierId: courier, ...settled });
    for (const [sub, roles] of [[e.requesterId, [Role.Requester]], [courier, [Role.Courier]]] as const) {
      expect(await view(e.id, sub, [...roles])).toMatchObject({ status: 'Resolved', ...settled });
      const mine = await (await get('/mine?status=Resolved', [...roles], sub)).json();
      expect(mine.items[0]).toMatchObject({ id: e.id, ...settled });
    }
  });

  it('keeps them off the open list, from non-parties, and from any status but Resolved', async () => {
    const e = await seed({ status: 'Resolved', courierId: randomUUID(), ...settled });
    expect((await get(`/${e.id}`, [Role.Courier], courier)).status).toBe(404);
    const open = await seed({ ...settled });
    expect((await list()).body.items[0]).not.toHaveProperty('settlementAmount');
    expect(await view(open.id, courier, [Role.Courier])).not.toHaveProperty('settlementNote');
    expect(await view(open.id, open.requesterId)).not.toHaveProperty('settlementAmount');
  });

  it('shows nothing after a rejection (columns cleared), and Settling-Credit as Incomplete', async () => {
    const rejected = await seed({ status: 'Incomplete', courierId: courier });
    const inFlight = await seed({ status: 'Settling-Credit', courierId: courier, ...settled });
    const a = await view(rejected.id, rejected.requesterId);
    expect(a.status).toBe('Incomplete');
    expect(a).not.toHaveProperty('settlementAmount');
    const b = await view(inFlight.id, inFlight.requesterId);
    expect(b.status).toBe('Incomplete');
    expect(b).not.toHaveProperty('settlementAmount');
    expect(b).not.toHaveProperty('settlementNote');
  });

  it('filters /mine by Resolved, and Incomplete includes Settling-Credit', async () => {
    const me = randomUUID();
    const done = await seed({ requesterId: me, status: 'Resolved', ...settled });
    const stuck = await seed({ requesterId: me, status: 'Settling-Credit' });
    const incomplete = await seed({ requesterId: me, status: 'Incomplete' });
    const mine = async (q: string) =>
      ids(await (await get(`/mine?status=${q}`, [Role.Requester], me)).json());
    expect(await mine('Resolved')).toEqual([done.id]);
    expect(new Set(await mine('Incomplete'))).toEqual(new Set([stuck.id, incomplete.id]));
  });
});

describe('GET /v1/admin/users/:userId/errands', () => {
  const target = randomUUID();
  const adminUrl = (path: string) => `${base.replace('/v1/errands', '/v1/admin')}${path}`;
  const admin = async (path: string, isAdmin = true) =>
    fetch(adminUrl(path), {
      headers: {
        authorization: `Bearer ${await signAccessToken({ sub: randomUUID(), roles: [], isAdmin })}`,
      },
    });
  const userErrands = async (query = '') => {
    const res = await admin(`/users/${target}/errands${query ? `?${query}` : ''}`);
    return { res, body: await res.json() };
  };

  it('rejects a missing token and a non-admin, whatever their roles', async () => {
    expect((await fetch(adminUrl(`/users/${target}/errands`))).status).toBe(401);
    expect((await admin(`/users/${target}/errands`, false)).status).toBe(403);
  });

  it('rejects a malformed user id', async () => {
    expect((await admin('/users/nope/errands')).status).toBe(400);
  });

  it('shows the settlement fields to an admin on a Resolved errand', async () => {
    await seed({ requesterId: target, status: 'Resolved', courierId: randomUUID(), settlementAmount: 3, settlementNote: 'Split it' });
    const { body } = await userErrands();
    expect(body.items[0]).toMatchObject({ status: 'Resolved', settlementAmount: 3, settlementNote: 'Split it' });
  });

  it("lists the user's errands on both sides with the internal sub-state and party fields", async () => {
    const asRequester = await seed({ requesterId: target, status: 'Reserving-Credit', createdAt: inHours(-2) });
    const asCourier = await seed({ courierId: target, status: 'Transferring-Credit', createdAt: inHours(-1) });
    await seed();
    const { res, body } = await userErrands();
    expect(res.status).toBe(200);
    expect(ids(body)).toEqual([asCourier.id, asRequester.id]);
    expect(body.items[0]).toMatchObject({
      status: 'Completed',
      internalStatus: 'Transferring-Credit',
      requesterId: asCourier.requesterId,
      courierId: target,
    });
    expect(body.items[1]).toMatchObject({ status: 'Pending', internalStatus: 'Reserving-Credit' });
    expect(body.items[0]).not.toHaveProperty('idempotencyKey');
    expect(body.items[0]).not.toHaveProperty('lastSequenceNumber');
  });

  it('applies role and status like /mine', async () => {
    const asRequester = await seed({ requesterId: target, status: 'Open' });
    await seed({ courierId: target, status: 'Accepted' });
    expect(ids((await userErrands('role=requester')).body)).toEqual([asRequester.id]);
    expect(ids((await userErrands('status=Open')).body)).toEqual([asRequester.id]);
  });

  it('is an empty list for a user with no errands', async () => {
    expect((await userErrands()).body).toEqual({ items: [], limit: 20, offset: 0 });
  });
});
