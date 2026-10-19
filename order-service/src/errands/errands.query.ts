import { Inject, Injectable } from '@nestjs/common';
import { type AnyColumn, and, asc, desc, gt, inArray, ne, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errands } from '../db/schema.js';
import type { Db } from '../lifecycle/transition.js';
import { INTERNAL_STATUSES_OF, toApiStatus } from './api-status.js';
import type { ListErrandsQuery, ListSort } from './errands.dto.js';

const ORDER: Record<ListSort, () => ReturnType<typeof asc>[]> = {
  expiring: () => [asc(errands.expiresAt)],
  newest: () => [desc(errands.createdAt)],
  credits: () => [desc(errands.rewardCredits)],
};

// The response allowlist: never idempotencyKey, lastSequenceNumber or
// cancellationReason. Parties' ids are added by the detail view.
const toView = (r: typeof errands.$inferSelect) => ({
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
    return { items: rows.map(toView), limit: q.limit, offset: q.offset };
  }
}
