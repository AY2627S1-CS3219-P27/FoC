import { Role } from '@foc/contracts';
import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { errands, roleBlocks } from '../db/schema.js';
import { ACTIVE_STATUSES } from '../lifecycle/status.js';
import type { Db } from '../lifecycle/transition.js';
import { TERMINAL_STATUS } from '../lifecycle/status.js';

export const BLOCKABLE_ROLES: BlockableRole[] = [Role.Requester, Role.Courier];
export type BlockableRole = Role.Requester | Role.Courier;

// Same Db/transaction handle type that transition() and createErrand() take.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type BlockResult =
  | { ok: true; blocked: BlockableRole[]; expiresAt: Date }
  | { ok: false; reason: 'ROLE_IN_USE'; inUse: BlockableRole[] };

// Serializes block, unblock, create and accept for one user. Held to commit.
// Lowercased: the key hashes text, but uuid columns compare case-insensitively.
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId.toLowerCase()}, 0))`,
  );
}

// The one rule for "is blocked": a row exists that has not expired.
// Call inside a transaction that has taken lockUser().
export async function isRoleBlocked(
  tx: Tx | Db,
  userId: string,
  role: BlockableRole,
): Promise<boolean> {
  const rows = await tx
    .select({ role: roleBlocks.role })
    .from(roleBlocks)
    .where(
      and(
        eq(roleBlocks.userId, userId),
        eq(roleBlocks.role, role),
        gt(roleBlocks.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function roleInUse(tx: Tx, userId: string, role: BlockableRole): Promise<boolean> {
  const where =
    role === Role.Requester
      ? and(
          eq(errands.requesterId, userId),
          notInArray(errands.status, TERMINAL_STATUS),
        )
      : and(eq(errands.courierId, userId), inArray(errands.status, ACTIVE_STATUSES));
  const rows = await tx.select({ id: errands.id }).from(errands).where(where).limit(1);
  return rows.length > 0;
}

// All or nothing: if any named role is in use, nothing is blocked.
export function blockRoles(
  db: Db,
  i: { userId: string; roles: BlockableRole[]; ttlMs: number },
): Promise<BlockResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, i.userId);
    const inUse: BlockableRole[] = [];
    for (const role of i.roles) {
      if (await roleInUse(tx, i.userId, role)) inUse.push(role);
    }
    if (inUse.length > 0) return { ok: false, reason: 'ROLE_IN_USE', inUse };

    const expiresAt = new Date(Date.now() + i.ttlMs);
    await tx
      .insert(roleBlocks)
      .values(i.roles.map((role) => ({ userId: i.userId, role, expiresAt })))
      .onConflictDoUpdate({
        target: [roleBlocks.userId, roleBlocks.role],
        set: { expiresAt: sql`excluded.expires_at` },
      });
    return { ok: true, blocked: i.roles, expiresAt };
  });
}

export function unblockRoles(
  db: Db,
  i: { userId: string; roles: BlockableRole[] },
): Promise<void> {
  return db.transaction(async (tx) => {
    await lockUser(tx, i.userId);
    await tx
      .delete(roleBlocks)
      .where(and(eq(roleBlocks.userId, i.userId), inArray(roleBlocks.role, i.roles)));
  });
}
