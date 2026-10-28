import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { disputeReports, errandEvents, errands } from '../db/schema.js';
import type { Db } from '../lifecycle/transition.js';

export type ReportResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_INCOMPLETE' | 'SETTLEMENT_REQUESTED' | 'ALREADY_REPORTED' };

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // A report is not a lifecycle transition: it writes no event. It locks for good
  // at the first SettlementRequested, even after the errand returns to Incomplete.
  async file(errandId: string, authorId: string, body: string): Promise<ReportResult> {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    const role =
      errand?.requesterId === authorId ? 'requester' : errand?.courierId === authorId ? 'courier' : null;
    if (!role) return { ok: false, reason: 'NOT_FOUND' }; // non-parties must not learn the errand exists

    const [requested] = await this.db
      .select({ type: errandEvents.type })
      .from(errandEvents)
      .where(and(eq(errandEvents.errandId, errandId), eq(errandEvents.type, 'SettlementRequested')))
      .limit(1);
    if (requested) return { ok: false, reason: 'SETTLEMENT_REQUESTED' };
    if (errand.status !== 'Incomplete') return { ok: false, reason: 'NOT_INCOMPLETE' };

    const inserted = await this.db
      .insert(disputeReports)
      .values({ errandId, authorId, role, body })
      .onConflictDoNothing()
      .returning({ id: disputeReports.errandId });
    return inserted.length ? { ok: true } : { ok: false, reason: 'ALREADY_REPORTED' };
  }
}
