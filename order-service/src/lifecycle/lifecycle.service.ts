import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errandEvents, errands } from '../db/schema.js';
import { enqueueRelease } from './notice.js';
import { createErrand, type CreateRequestInputs } from './create.js';
import { rebuildProjection } from './rebuild.js';
import type { Status } from './status.js';
import { transition, type Db, type TransitionInput } from './transition.js';

export interface ReplyErrand {
  status: Status;
  supplierId: string;
  deliveryBuildingId: string; // the pending one while revalidating
  storedDeliveryBuildingId: string;
  deliveryDetail: string;
  // Editing: the new reward waiting for credit. Adjusting-Credit after SupplierConfirmed: the supplier columns waiting for it.
  pendingAmount: number | null;
  confirmed: Record<string, unknown> | null;
}


@Injectable()
export class LifecycleService {
  constructor(@Inject(DB) private readonly db: Db) {}

  create(i: CreateRequestInputs) {
    return createErrand(this.db, i);
  }

  transition(i: TransitionInput) {
    return transition(this.db, i);
  }

  // Late reservation success for a Cancelled errand.
  releaseCredit(errandId: string, replyEventId: string) {
    return enqueueRelease(this.db, errandId, replyEventId);
  }

  rebuild(errandId: string) {
    return rebuildProjection(this.db, errandId);
  }

  // used for incoming cancel HTTP requests and cancel has to 
  // know where it is coming from
  async currentStatus(errandId: string): Promise<Status | undefined> {
    const [row] = await this.db
      .select({ status: errands.status })
      .from(errands)
      .where(eq(errands.id, errandId));
    return row?.status;
  }

  // The supplier a reply should be about: the pending one while revalidating (F2).
  async supplierIdOf(errandId: string): Promise<string | undefined> {
    return (await this.replyErrandOf(errandId))?.supplierId;
  }

  // What a supplier reply is checked against.
  async replyErrandOf(errandId: string): Promise<ReplyErrand | undefined> {
    const [row] = await this.db
      .select({
        status: errands.status,
        supplierId: sql<string>`coalesce(${errands.pendingSupplierId}, ${errands.supplierId})`,
        deliveryBuildingId: sql<string>`coalesce(${errands.pendingDeliveryBuildingId}, ${errands.deliveryBuildingId})`,
        storedDeliveryBuildingId: errands.deliveryBuildingId,
        deliveryDetail: errands.deliveryDetail,
        pendingAmount: sql<number | null>`(SELECT (e.payload->>'newAmount')::int FROM errand_events e
          WHERE e.errand_id = ${errands.id} AND e.type = 'EditRequested' ORDER BY e.sequence_number DESC LIMIT 1)`,
        // Only the event that entered Adjusting-Credit counts: an older chained edit must not leak into a later one.
        confirmed: sql<Record<string, unknown> | null>`(SELECT e.payload->'apply' FROM errand_events e
          WHERE e.errand_id = ${errands.id} AND e.type = 'SupplierConfirmed'
            AND e.sequence_number = ${errands.lastSequenceNumber})`,
      })
      .from(errands)
      .where(eq(errands.id, errandId));
    if (row?.confirmed?.supplierValidatedAt) {
      row.confirmed = { ...row.confirmed, supplierValidatedAt: new Date(row.confirmed.supplierValidatedAt as string) };
    }
    return row;
  }

  // The pin given at creation. Read from the ErrandCreated event, not the row: validation
  // overwrites the row's coordinates, and a redelivered reply must see the same answer.
  async pinOf(errandId: string): Promise<{ latitude: number; longitude: number } | undefined> {
    const [row] = await this.db
      .select({ payload: errandEvents.payload })
      .from(errandEvents)
      .where(and(eq(errandEvents.errandId, errandId), eq(errandEvents.sequenceNumber, 1)));
    const { deliveryLatitude: latitude, deliveryLongitude: longitude } = (row?.payload ?? {}) as Record<string, unknown>;
    return typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : undefined;
  }

  async lastEvent(
    errandId: string,
  ): Promise<{ fromStatus: Status | null; toStatus: Status; type: string } | undefined> {
    const [row] = await this.db
      .select({
        fromStatus: errandEvents.fromStatus,
        toStatus: errandEvents.toStatus,
        type: errandEvents.type,
      })
      .from(errandEvents)
      .where(eq(errandEvents.errandId, errandId))
      .orderBy(desc(errandEvents.sequenceNumber))
      .limit(1);
    return row;
  }
}
