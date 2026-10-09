import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module.js';
import { createErrand, type CreateRequestInputs } from './create.js';
import { rebuildProjection } from './rebuild.js';
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

  rebuild(errandId: string) {
    return rebuildProjection(this.db, errandId);
  }
}
