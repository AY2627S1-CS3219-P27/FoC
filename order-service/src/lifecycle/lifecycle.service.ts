import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module.js';
import { createErrand, type CreateInput } from './create.js';
import { transition, type Db, type TransitionInput } from './transition.js';


@Injectable()
export class LifecycleService {
  constructor(@Inject(DB) private readonly db: Db) {}

  create(i: CreateInput) {
    return createErrand(this.db, i);
  }

  transition(i: TransitionInput) {
    return transition(this.db, i);
  }
}
