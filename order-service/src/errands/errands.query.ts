import { Inject, Injectable } from '@nestjs/common';
import { type AnyColumn, and, asc, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errands } from '../db/schema.js';
import type { Db } from '../lifecycle/transition.js';
import { INTERNAL_STATUSES_OF, toApiStatus } from './api-status.js';
import type { ListErrandsQuery, ListSort, MineErrandsQuery } from './errands.dto.js';

const ORDER: Record<ListSort, () => ReturnType<typeof asc>[]> = {
  expiring: () => [asc(errands.expiresAt)],
  newest: () => [desc(errands.createdAt)],
  credits: () => [desc(errands.rewardCredits)],
};

// The response allowlist: never idempotencyKey, lastSequenceNumber or
// cancellationReason. The parties' ids are added only for the parties.
const toView = (r: typeof errands.$inferSelect, callerId?: string) => ({
  id: r.id,
  status: toApiStatus(r.status),
  supplierId: r.supplierId,
  pickupLocation: r.pickupLocation,
  deliveryLocation: r.deliveryLocation,
  collectionItems: r.collectionItems,
  description: r.description,
  rewardCredits: r.rewardCredits,
  expiresAt: r.expiresAt,
  createdAt: r.createdAt,
  ...(callerId !== undefined && (callerId === r.requesterId || callerId === r.courierId)
    ? { requesterId: r.requesterId, courierId: r.courierId }
    : {}),
});

// The read side. Owns every errand SELECT; never writes (Lifecycle stays the
// only writer) and never calls transition().
@Injectable()
export class ErrandsQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Courier browse list: open, unexpired errands that are not the caller's own.
  async list(callerId: string, q: ListErrandsQuery) {
    const sameText = (col: AnyColumn, v: string) =>
      sql`lower(${col}) = lower(${v})`;
    const rows = await this.db
      .select()
      .from(errands)
      .where(
        and(
          inArray(errands.status, [...INTERNAL_STATUSES_OF.Open]),
          gt(errands.expiresAt, sql`now()`),
          ne(errands.requesterId, callerId),
          q.pickupBuilding ? sameText(errands.pickupLocation, q.pickupBuilding) : undefined,
          q.deliveryBuilding ? sameText(errands.deliveryLocation, q.deliveryBuilding) : undefined,
          q.minCredits ? sql`${errands.rewardCredits} >= ${q.minCredits}` : undefined,
        ),
      )
      .orderBy(...ORDER[q.sort](), asc(errands.id))
      .limit(q.limit)
      .offset(q.offset);
    return { items: rows.map((r) => toView(r)), limit: q.limit, offset: q.offset };
  }

  // The caller's errands, as requester or courier, newest first.
  async mine(callerId: string, q: MineErrandsQuery) {
    const rows = await this.db
      .select()
      .from(errands)
      .where(
        and(
          or(eq(errands.requesterId, callerId), eq(errands.courierId, callerId)),
          q.status ? inArray(errands.status, [...INTERNAL_STATUSES_OF[q.status]]) : undefined,
        ),
      )
      .orderBy(desc(errands.createdAt), asc(errands.id))
      .limit(q.limit)
      .offset(q.offset);
    return { items: rows.map((r) => toView(r, callerId)), limit: q.limit, offset: q.offset };
  }

  // Parties see any status, expired or not (expiresAt tells the app); everyone
  // else only an Open, unexpired errand. Otherwise null, which the controller makes a 404.
  async detail(callerId: string, id: string) {
    const [row] = await this.db.select().from(errands).where(eq(errands.id, id));
    if (!row) return null;
    const party = callerId === row.requesterId || callerId === row.courierId;
    const open =
      (INTERNAL_STATUSES_OF.Open as readonly string[]).includes(row.status) &&
      row.expiresAt !== null &&
      row.expiresAt > new Date();
    return party || open ? toView(row, callerId) : null;
  }
}
