import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS } from '../redis/redis.provider.js';
import { type RedisClientType } from 'redis';
import { BLOCK_EXPIRATION_IN_SECONDS } from '../common/constants.js';
import { adminBlockKey } from '../common/hash/token-keys.js';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(@Inject(REDIS) private redis: RedisClientType) {}

  /**
   * Records a block for a demoted admin, so access tokens issued before the
   * demotion no longer pass admin-only endpoints.
   *
   * Best effort: callers invoke this *after* the demotion has committed, so
   * a Redis failure must not surface as an error for a change that is
   * already durable. The worst case is the bounded stale-token window
   * (BLOCK_EXPIRATION_IN_SECONDS); the error is logged instead.
   */
  async createAdminBlock(uuid: string) {
    try {
      await this.redis.set(adminBlockKey(uuid), 1, {
        EX: BLOCK_EXPIRATION_IN_SECONDS,
      });
    } catch (err) {
      this.logger.error(
        `Failed to create admin block for ${uuid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async checkIsAdminBlocked(uuid: string) {
    const val = await this.redis.get(adminBlockKey(uuid));
    return val !== null;
  }
}
