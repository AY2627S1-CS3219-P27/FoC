import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import { errands } from '../db/schema.js';
import type { Status } from '../lifecycle/status.js';
import type { Db } from '../lifecycle/transition.js';

export const ERRAND_READER = Symbol('ERRAND_READER');

export interface TrackedErrand {
  id: string;
  requesterId: string;
  courierId: string | null;
  status: Status;
}

// Read-only view of the errand for access checks. Never writes errand state.
export interface ErrandReader {
  find(errandId: string): Promise<TrackedErrand | null>;
}

@Injectable()
export class DbErrandReader implements ErrandReader {
  constructor(@Inject(DB) private readonly db: Db) {}

  async find(errandId: string) {
    const [row] = await this.db
      .select({
        id: errands.id,
        requesterId: errands.requesterId,
        courierId: errands.courierId,
        status: errands.status,
      })
      .from(errands)
      .where(eq(errands.id, errandId));
    return row ?? null;
  }
}
