import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { ErrorCode } from '../errors/error-response.js';

/**
 * Nest's ParseUUIDPipe, answering a malformed id in the standard validation
 * error shape (which field, and why) instead of a bare message (N8.4.1.1).
 */
export function uuidParam(field: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Request validation failed.',
        violations: [{ field, reason: `${field} must be a UUID` }],
      }),
  });
}
