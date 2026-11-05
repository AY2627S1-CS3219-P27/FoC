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

// NOT_CANCELLABLE and ERRAND_UNAVAILABLE are the controller's own refusals
// (the latter re-labels a lost accept race), so they are not in TransitionResult.
type Result =
  | CreateResult
  | TransitionResult
  | { ok: false; reason: 'NOT_CANCELLABLE' | 'ERRAND_UNAVAILABLE' };

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
  NOT_CANCELLABLE: {
    exception: ConflictException,
    message: 'This errand can no longer be cancelled at its current stage.',
  },
  ERRAND_UNAVAILABLE: {
    exception: ConflictException,
    message: 'This errand is no longer available.',
  },
  EXPIRED: {
    exception: ConflictException,
    message: 'This errand has expired and can no longer be accepted.',
  },
  COURIER_BUSY: {
    exception: ConflictException,
    message: 'You already have an active errand. Finish it before accepting another.',
  },
  ROLE_BLOCKED: {
    exception: ForbiddenException,
    message: 'Your role is being changed. Try again in a few minutes.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    exception: UnprocessableEntityException,
    message: 'This Idempotency-Key was already used for a different request.',
  },
};

// Response header that tells a client its request repeated one that already
// succeeded, so nothing new was written this time.
export const REPLAYED_HEADER = 'Idempotent-Replayed';

// A rejection replays as the same error, so only a success can be a replay.
export const isReplay = (result: Result): boolean =>
  result.ok && result.replayed === true;

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

