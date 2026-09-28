import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ErrorCode, type FieldViolation } from './error-response.js';

/**
 * Flattens class-validator's nested error tree into one violation per failed
 * rule, so a rejection lists every non-compliant field and the reason for
 * each rather than only the first failure (F1.6.1, N8.4.1.1).
 */
export function toFieldViolations(
  errors: ValidationError[],
  parentPath = '',
): FieldViolation[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((reason) => ({
      field,
      reason,
    }));
    return [...own, ...toFieldViolations(error.children ?? [], field)];
  });
}

/** exceptionFactory for the global ValidationPipe. */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Request validation failed.',
    violations: toFieldViolations(errors),
  });
}
