import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB } from '../db/db.module.js';
import type { Db } from '../lifecycle/transition.js';
import { type BlockableRole, blockRoles, unblockRoles } from './role-blocks.js';

@Injectable()
export class RoleBlocksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  block(userId: string, roles: BlockableRole[]) {
    return blockRoles(this.db, {
      userId,
      roles,
      ttlMs: this.config.getOrThrow<number>('ROLE_BLOCK_TTL_MS'),
    });
  }

  unblock(userId: string, roles: BlockableRole[]) {
    return unblockRoles(this.db, { userId, roles });
  }
}
