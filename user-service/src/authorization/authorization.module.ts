import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { AdminBlockGuard } from './admin-block-guard/admin-block.guard.js';

@Module({
  providers: [AuthorizationService, RedisProvider, AdminBlockGuard],
  exports: [AuthorizationService, AdminBlockGuard],
})
export class AuthorizationModule {}
