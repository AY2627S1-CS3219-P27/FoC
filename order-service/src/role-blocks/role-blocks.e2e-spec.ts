import { randomUUID } from 'node:crypto';
import { Role } from '@foc/contracts';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errands, roleBlocks } from '../db/schema.js';
import { createErrand } from '../lifecycle/create.js';
import { STATUSES, type Status } from '../lifecycle/status.js';
import { type BlockableRole, blockRoles, isRoleBlocked, unblockRoles } from './role-blocks.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const TTL = 60_000;
const block = (userId: string, roles: BlockableRole[]) =>
  blockRoles(t.db, { userId, roles, ttlMs: TTL });

// An errand for the requester, forced into `status` (with a courier if given).
async function errandIn(status: Status, requesterId: string, courierId?: string) {
  const res = await createErrand(t.db, {
    requesterId,
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
  });
  if (!res.ok) throw new Error('create failed');
  await t.db
    .update(errands)
    .set({ status, courierId: courierId ?? null })
    .where(eq(errands.id, res.errandId));
}

describe('blockRoles', () => {
  it('blocks a user with no errands and reports the expiry', async () => {
    const userId = randomUUID();
    const res = await block(userId, [Role.Requester, Role.Courier]);
    expect(res).toMatchObject({ ok: true, blocked: [Role.Requester, Role.Courier] });
    expect(await isRoleBlocked(t.db, userId, Role.Requester)).toBe(true);
    expect(await isRoleBlocked(t.db, userId, Role.Courier)).toBe(true);
  });

  const TERMINAL: Status[] = ['Completed', 'Cancelled', 'Incomplete'];
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
