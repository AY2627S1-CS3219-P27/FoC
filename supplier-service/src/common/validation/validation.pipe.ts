import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../errors/validation-exception.factory.js';

/**
 * The one ValidationPipe every request goes through (F1.7: validation happens
 * server-side on every request, whatever the client already checked).
 *
 * Differs from user-service's `whitelist: true` on purpose: unknown fields,
 * including system-managed ones such as `id` or `version`, are rejected
 * rather than silently stripped (F1.6, F1.3.2), and every violation is
 * reported together (F1.6.1).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
