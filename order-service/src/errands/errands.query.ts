import { Role } from '@foc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { type AnyColumn, and, asc, count, desc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { disputeReports, errandEvents, errands } from '../db/schema.js';
import { CREDIT_SETTLEMENT_REJECTED } from '../lifecycle/edges.js';
import type { Db } from '../lifecycle/transition.js';
import { INTERNAL_STATUSES_OF, toApiStatus } from './api-status.js';
import type { ListErrandsQuery, ListSort, MineErrandsQuery, PageQuery } from './errands.dto.js';

const ORDER: Record<ListSort, () => ReturnType<typeof asc>[]> = {
  expiring: () => [asc(errands.expiresAt)],
  newest: () => [desc(errands.createdAt)],
  credits: () => [desc(errands.rewardCredits)],
};

// The response allowlist: never idempotencyKey or lastSequenceNumber.
// The parties' ids and the cancellation reason are added only for the parties.
const toView = (r: typeof errands.$inferSelect, callerId?: string) => ({
  id: r.id,
  status: toApiStatus(r.status),
  supplierId: r.supplierId,
  pickupLocation: r.pickupLocation,
  pickupName: r.pickupName,
  pickupDescription: r.pickupDescription,
  deliveryLocation: r.deliveryLocation,
  collectionItems: r.collectionItems,
  description: r.description,
  rewardCredits: r.rewardCredits,
  expiresAt: r.expiresAt,
  createdAt: r.createdAt,
  ...(callerId !== undefined && (callerId === r.requesterId || callerId === r.courierId)
    ? { requesterId: r.requesterId, courierId: r.courierId, cancellationReason: r.cancellationReason }
    : {}),
});

// Admin allowlist (F9.3.3): adds the internal sub-state and lifecycle timestamps.
const toAdminView = (r: typeof errands.$inferSelect) => ({
  ...toView(r, r.requesterId),
  internalStatus: r.status,
  pickedUpAt: r.pickedUpAt,
  deliveredAt: r.deliveredAt,
  updatedAt: r.updatedAt,
});

// Dispute detail allowlists: rows are never returned as stored, so a new column stays
// private until it is added here. errandId is dropped (it is in the URL).
const toEventView = (e: typeof errandEvents.$inferSelect) => ({
  sequenceNumber: e.sequenceNumber,
  type: e.type,
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
  payload: e.payload,
  actorId: e.actorId,
  occurredAt: e.occurredAt,
});
const toReportView = (r: typeof disputeReports.$inferSelect) => ({
  authorId: r.authorId,
  role: r.role,
  body: r.body,
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
    return { items: rows.map((r) => toView(r)), limit: q.limit, offset: q.offset };
  }

  // The caller's errands, as requester or courier, newest first.
  async mine(callerId: string, q: MineErrandsQuery) {
    const rows = await this.partyRows(callerId, q);
    return { items: rows.map((r) => toView(r, callerId)), limit: q.limit, offset: q.offset };
  }

  async ofUserForAdmin(userId: string, q: MineErrandsQuery) {
    const rows = await this.partyRows(userId, q);
    return { items: rows.map(toAdminView), limit: q.limit, offset: q.offset };
  }

  // Dispute queue: every Incomplete errand, including the in-flight Settling-Credit
  // (`internalStatus` tells them apart), longest-disputed first: by the first time it
  // entered Incomplete, so a rejected settlement keeps its place. `reports` says which
  // side filed one, never what it says.
  async disputeQueue(q: PageQuery) {
    const rows = await this.db
      .select({
        errand: errands,
        reporters: sql<string[]>`coalesce((select array_agg(${disputeReports.role}) from ${disputeReports} where ${disputeReports.errandId} = ${errands.id}), '{}')`,
      })
      .from(errands)
      .where(inArray(errands.status, [...INTERNAL_STATUSES_OF.Incomplete]))
      .orderBy(
        sql`(select min(${errandEvents.occurredAt}) from ${errandEvents} where ${errandEvents.errandId} = ${errands.id} and ${errandEvents.toStatus} = 'Incomplete')`,
        asc(errands.id),
      )
      .limit(q.limit)
      .offset(q.offset);
    return {
      items: rows.map(({ errand, reporters }) => ({
        ...toAdminView(errand),
        reports: { requester: reporters.includes('requester'), courier: reporters.includes('courier') },
      })),
      limit: q.limit,
      offset: q.offset,
    };
  }

  // Null (a 404) when the errand is unknown or not Incomplete (Settling-Credit counts).
  async disputeDetail(id: string) {
    // One snapshot, so the errand, reports and events can't disagree if a transition lands mid-read.
    return this.db.transaction(
      async (tx) => {
        const [errand] = await tx
          .select()
          .from(errands)
          .where(and(eq(errands.id, id), inArray(errands.status, [...INTERNAL_STATUSES_OF.Incomplete])));
        if (!errand) return null;
        const reports = await tx.select().from(disputeReports).where(eq(disputeReports.errandId, id)).orderBy(asc(disputeReports.createdAt));
        const events = await tx.select().from(errandEvents).where(eq(errandEvents.errandId, id)).orderBy(asc(errandEvents.sequenceNumber));
        const latestRejection = events.findLast((e) => e.type === CREDIT_SETTLEMENT_REJECTED) ?? null;
        return {
          errand: toAdminView(errand),
          reports: reports.map(toReportView),
          events: events.map(toEventView),
          latestRejection: latestRejection && toEventView(latestRejection),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  // What the resolve route checks before settling: the errand's status and reward,
  // and its credit rejections in the last hour (the retry cap counts the event log).
  async resolveGate(id: string) {
    const [errand] = await this.db
      .select({ status: errands.status, rewardCredits: errands.rewardCredits })
      .from(errands)
      .where(eq(errands.id, id));
    if (!errand) return undefined;
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(errandEvents)
      .where(
        and(
          eq(errandEvents.errandId, id),
          eq(errandEvents.type, CREDIT_SETTLEMENT_REJECTED),
          gt(errandEvents.occurredAt, new Date(Date.now() - 3_600_000)),
        ),
      );
    return { ...errand, recentRejections: n };
  }

  private partyRows(userId: string, q: MineErrandsQuery) {
    const asRequester = eq(errands.requesterId, userId);
    const asCourier = eq(errands.courierId, userId);
    const side =
      q.role === Role.Requester ? asRequester
      : q.role === Role.Courier ? asCourier
      : or(asRequester, asCourier);
    return this.db
      .select()
      .from(errands)
      .where(
        and(
          side,
          q.status ? inArray(errands.status, [...INTERNAL_STATUSES_OF[q.status]]) : undefined,
        ),
      )
      .orderBy(desc(errands.createdAt), asc(errands.id))
      .limit(q.limit)
      .offset(q.offset);
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
