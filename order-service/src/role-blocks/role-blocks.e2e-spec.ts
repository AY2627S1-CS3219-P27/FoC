import { randomUUID } from 'node:crypto';
import { Role } from '@foc/contracts';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errands, roleBlocks } from '../db/schema.js';
import { createErrand } from '../lifecycle/create.js';
import { STATUSES, type Status } from '../lifecycle/status.js';
import { transition, user } from '../lifecycle/transition.js';
import { type BlockableRole, blockRoles, isRoleBlocked, unblockRoles } from './role-blocks.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const TTL = 60_000;
const block = (userId: string, roles: BlockableRole[]) =>
  blockRoles(t.db, { userId, roles, ttlMs: TTL });
const create = (requesterId: string, idempotencyKey?: string) =>
  createErrand(t.db, {
    requesterId,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
    idempotencyKey,
  });
const accept = (errandId: string, courierId: string, idempotencyKey?: string) =>
  transition(t.db, {
    errandId,
    expected: 'Open',
    to: 'Accepted',
    actor: user(courierId),
    set: { courierId },
    idempotencyKey,
  });

// An errand for the requester, forced into `status` (with a courier if given).
async function errandIn(status: Status, requesterId: string, courierId?: string): Promise<string> {
  const res = await create(requesterId);
  if (!res.ok) throw new Error('create failed');
  await t.db
    .update(errands)
    .set({ status, courierId: courierId ?? null })
    .where(eq(errands.id, res.errandId));
  return res.errandId;
}

describe('blockRoles', () => {
  it('blocks a user with no errands and reports the expiry', async () => {
    const userId = randomUUID();
    const res = await block(userId, [Role.Requester, Role.Courier]);
    expect(res).toMatchObject({ ok: true, blocked: [Role.Requester, Role.Courier] });
    expect(await isRoleBlocked(t.db, userId, Role.Requester)).toBe(true);
    expect(await isRoleBlocked(t.db, userId, Role.Courier)).toBe(true);
  });

  const TERMINAL: Status[] = ['Completed', 'Cancelled', 'Resolved'];
  it.each(STATUSES.map((s) => [s]))('requester with an errand in %s', async (status) => {
    const userId = randomUUID();
    await errandIn(status, userId);
    expect((await block(userId, [Role.Requester])).ok).toBe(TERMINAL.includes(status));
  });

  it.each(STATUSES.map((s) => [s]))('courier with an errand in %s', async (status) => {
    const userId = randomUUID();
    await errandIn(status, randomUUID(), userId);
    expect((await block(userId, [Role.Courier])).ok).toBe(status !== 'Accepted' && status !== 'Picked Up');
  });

  it('blocks nothing when one of two roles is in use', async () => {
    const userId = randomUUID();
    await errandIn('Open', userId);
    expect(await block(userId, [Role.Requester, Role.Courier])).toEqual({
      ok: false,
      reason: 'ROLE_IN_USE',
      inUse: [Role.Requester],
    });
    expect(await t.db.select().from(roleBlocks).where(eq(roleBlocks.userId, userId))).toEqual([]);
  });

  it('refreshes the expiry when repeated, and leaves the other role alone', async () => {
    const userId = randomUUID();
    const first = await block(userId, [Role.Requester]);
    const second = await block(userId, [Role.Requester]);
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(second.expiresAt.getTime()).toBeGreaterThanOrEqual(first.expiresAt.getTime());
    expect(await isRoleBlocked(t.db, userId, Role.Courier)).toBe(false);
  });

  it('ignores an expired block', async () => {
    const userId = randomUUID();
    await t.db
      .insert(roleBlocks)
      .values({ userId, role: Role.Requester, expiresAt: new Date(Date.now() - 1000) });
    expect(await isRoleBlocked(t.db, userId, Role.Requester)).toBe(false);
  });
});

describe('unblockRoles', () => {
  it('removes the named roles only, and is safe to repeat', async () => {
    const userId = randomUUID();
    await block(userId, [Role.Requester, Role.Courier]);
    await unblockRoles(t.db, { userId, roles: [Role.Requester] });
    await unblockRoles(t.db, { userId, roles: [Role.Requester] });
    expect(await isRoleBlocked(t.db, userId, Role.Requester)).toBe(false);
    expect(await isRoleBlocked(t.db, userId, Role.Courier)).toBe(true);
  });
});

describe('enforcement on create', () => {
  it('refuses a blocked requester and keeps the key free for a retry after unblock', async () => {
    const userId = randomUUID();
    await block(userId, [Role.Requester]);
    expect(await create(userId, 'k1')).toEqual({ ok: false, reason: 'ROLE_BLOCKED' });
    expect(await t.db.select().from(errands).where(eq(errands.requesterId, userId))).toEqual([]);

    await unblockRoles(t.db, { userId, roles: [Role.Requester] });
    expect(await create(userId, 'k1')).toMatchObject({ ok: true });
  });

  it('ignores an expired block', async () => {
    const userId = randomUUID();
    await t.db
      .insert(roleBlocks)
      .values({ userId, role: Role.Requester, expiresAt: new Date(Date.now() - 1000) });
    expect(await create(userId)).toMatchObject({ ok: true });
  });
});

describe('enforcement on accept', () => {
  it('refuses a blocked courier and keeps the key free for a retry after unblock', async () => {
    const courierId = randomUUID();
    const id = await errandIn('Open', randomUUID());
    await block(courierId, [Role.Courier]);
    expect(await accept(id, courierId, 'k1')).toEqual({ ok: false, reason: 'ROLE_BLOCKED' });
    const [row] = await t.db.select().from(errands).where(eq(errands.id, id));
    expect(row).toMatchObject({ status: 'Open', courierId: null });

    await unblockRoles(t.db, { userId: courierId, roles: [Role.Courier] });
    expect(await accept(id, courierId, 'k1')).toMatchObject({ ok: true });
  });

  it('lets a user blocked as requester still accept, and as courier still create', async () => {
    const userId = randomUUID();
    await block(userId, [Role.Requester]);
    expect(await accept(await errandIn('Open', randomUUID()), userId)).toMatchObject({ ok: true });

    const other = randomUUID();
    await block(other, [Role.Courier]);
    expect(await create(other)).toMatchObject({ ok: true });
  });

  it('ignores an expired block', async () => {
    const courierId = randomUUID();
    await t.db
      .insert(roleBlocks)
      .values({ userId: courierId, role: Role.Courier, expiresAt: new Date(Date.now() - 1000) });
    expect(await accept(await errandIn('Open', randomUUID()), courierId)).toMatchObject({ ok: true });
  });
});

describe('concurrency', () => {
  // Without the per-user lock, both sides read "nothing there" and both succeed.
  it('never lets a block and a create for the same user both succeed', async () => {
    for (let n = 0; n < 20; n++) {
      const userId = randomUUID();
      const [blocked, created] = await Promise.all([
        block(userId, [Role.Requester]),
        create(userId),
      ]);
      expect(blocked.ok && created.ok).toBe(false);
      expect(blocked.ok || created.ok).toBe(true);
    }
  });

  it('never lets a block and an accept by the same courier both succeed', async () => {
    for (let n = 0; n < 20; n++) {
      const courierId = randomUUID();
      const errandId = await errandIn('Open', randomUUID());
      // Upper case on one side: both must still take the same advisory lock.
      const [blocked, accepted] = await Promise.all([
        block(courierId.toUpperCase(), [Role.Courier]),
        accept(errandId, courierId),
      ]);
      expect(blocked.ok && accepted.ok).toBe(false);
      expect(blocked.ok || accepted.ok).toBe(true);
    }
  });
});
