import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyPurge } from './idempotency-purge.lifecycle.js';
import { IdempotencyService } from './idempotency.service.js';

/** Global, so any controller can use @Idempotent() without importing it. */
@Global()
@Module({
  providers: [IdempotencyService, IdempotencyInterceptor, IdempotencyPurge],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
