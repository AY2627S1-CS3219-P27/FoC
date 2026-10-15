import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errands } from '../db/schema.js';
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

  // The errand's status right now, or undefined if there is no such errand.
  // Only a guess for a caller picking `expected`: it may change before the
  // transition runs, and transition()'s WHERE status = expected catches that.
  async currentStatus(errandId: string): Promise<Status | undefined> {
    const [row] = await this.db
      .select({ status: errands.status })
      .from(errands)
      .where(eq(errands.id, errandId));
    return row?.status;
  }
}
