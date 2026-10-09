import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../errors/error-response.js';

/** `"3"`, `W/"3"` or a bare `3`: the version from an ETag we issued. */
const VERSION_TAG = /^(?:W\/)?"?([1-9][0-9]*)"?$/;

/**
 * Reads the supplier version an edit is based on from the If-Match header
 * (F14.3). Carrying it in a header, not the body, keeps `version` a
 * system-managed field that no request body may set (F1.3.2).
 *
 * Missing → 428 PRECONDITION_REQUIRED; malformed → 400 VALIDATION_FAILED.
 */
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw new HttpException(
      {
        code: ErrorCode.PreconditionRequired,
        message:
          'This change must state the supplier version it is based on: send its ETag in an If-Match header.',
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const match = VERSION_TAG.exec(header.trim());
  if (!match) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Request validation failed.',
      violations: [
        {
          field: 'If-Match',
          reason: 'If-Match must be the supplier ETag, e.g. "3"',
        },
      ],
    });
  }
  return Number(match[1]);
}
