import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateResult } from '../lifecycle/create.js';
import type { TransitionResult } from '../lifecycle/transition.js';

// Turns what create() / transition() return into an HTTP answer: the
// success body, or a thrown Nest exception that Nest sends as the error.

type Result = CreateResult | TransitionResult;

// Every failure `reason` string from both result types.
type FailureReason = Extract<Result, { ok: false }>['reason'];

// Builds the exception to throw; Nest sends `body` as the JSON response.
type ExceptionClass = new (body: { code: string; message: string }) => HttpException;

const FAILURES: Record<FailureReason, { exception: ExceptionClass; message: string }> = {
  INVALID_FIELDS: {
    exception: BadRequestException,
    message: 'The request is missing a field or has an invalid value.',
  },
  FORBIDDEN: {
    exception: ForbiddenException,
    message: 'You are not allowed to do this on this errand.',
  },
  NOT_FOUND: {
    exception: NotFoundException,
    message: 'Errand not found.',
  },
  STATE_MISMATCH: {
    exception: ConflictException,
    message: 'The errand has changed and this action no longer applies. Refresh and try again.',
  },
  ILLEGAL_TRANSITION: {
    exception: ConflictException,
    message: 'This action is not possible for the errand at this stage.',
  },
  EXPIRED: {
    exception: ConflictException,
    message: 'This errand has expired and can no longer be accepted.',
  },
  COURIER_BUSY: {
    exception: ConflictException,
    message: 'You already have an active errand. Finish it before accepting another.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    exception: UnprocessableEntityException,
    message: 'This Idempotency-Key was already used for a different request.',
  },
};

export function resultToHttp(
  result: Result,
): { errandId: string } | { sequenceNumber: number } {
  if (!result.ok) {
    const { exception, message } = FAILURES[result.reason];
    throw new exception({ code: result.reason, message });
  }
  return 'errandId' in result
    ? { errandId: result.errandId }
    : { sequenceNumber: result.sequenceNumber };
}

