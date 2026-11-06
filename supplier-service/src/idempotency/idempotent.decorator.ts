import { UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Marks an endpoint that creates a record: it then honours an optional
 * `Idempotency-Key` header (F14.2).
 */
export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);
