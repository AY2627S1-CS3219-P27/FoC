import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errandEvents, errands } from '../db/schema.js';
import { enqueueRelease } from './notice.js';
import { createErrand, type CreateRequestInputs } from './create.js';
import { rebuildProjection } from './rebuild.js';
import type { Status } from './status.js';
import { transition, type Db, type TransitionInput } from './transition.js';


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

  async supplierIdOf(errandId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ supplierId: errands.supplierId })
      .from(errands)
      .where(eq(errands.id, errandId));
    return row?.supplierId;
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
