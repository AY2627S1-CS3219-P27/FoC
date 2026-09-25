import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isDependencyUnavailableError } from './dependency-unavailable.js';
import {
  ErrorCode,
  type ErrorResponseBody,
  type FieldViolation,
} from './error-response.js';

/** Seconds a client should wait before retrying a 503 (N7.5). */
export const RETRY_AFTER_SECONDS = 1;

const DEFAULT_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BadRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthenticated,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.CONFLICT]: ErrorCode.Conflict,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PayloadTooLarge,
  [HttpStatus.PRECONDITION_REQUIRED]: ErrorCode.PreconditionRequired,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.DependencyUnavailable,
};

/** Status text for the `error` field, matching Nest's default bodies. */
function statusText(status: number): string {
  const name = HttpStatus[status] as string | undefined;
  if (!name) {
    return 'Error';
  }
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Errors raised by Express's body parser before a route handler runs. */
function bodyParserStatus(exception: unknown): number | undefined {
  const { type, status } = (exception ?? {}) as {
    type?: unknown;
    status?: unknown;
  };
  if (typeof type === 'string' && typeof status === 'number') {
    return status;
  }
  return undefined;
}

/**
 * Renders every failure in the single error shape (ErrorResponseBody):
 * - HttpExceptions keep their status; a `code` or `violations` supplied in
 *   the exception body is preserved, otherwise a code is derived from status.
 * - Body-parser failures keep their 4xx status (e.g. 413 PAYLOAD_TOO_LARGE).
 * - An unreachable database becomes a retryable 503 (F15.3, F14.1.1, N7.5).
 * - Anything else is a 500 whose details are logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<unknown>();
    const body = this.toBody(exception);

    if (body.retryable) {
      httpAdapter.setHeader(response, 'Retry-After', `${RETRY_AFTER_SECONDS}`);
    }
    httpAdapter.reply(response, body, body.statusCode);
  }

  toBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Nest already turns invalid JSON (a SyntaxError) into a 400
    // BadRequestException; other body-parser failures, such as an oversized
    // body, arrive raw and must keep their 4xx status instead of becoming 500.
    const parserStatus = bodyParserStatus(exception);
    if (parserStatus !== undefined) {
      const tooLarge = parserStatus === HttpStatus.PAYLOAD_TOO_LARGE;
      return {
        statusCode: parserStatus,
        error: statusText(parserStatus),
        message: tooLarge
          ? 'Request body is too large.'
          : 'Request body could not be read.',
        code: tooLarge ? ErrorCode.PayloadTooLarge : ErrorCode.BadRequest,
      };
    }

    if (isDependencyUnavailableError(exception)) {
      this.logger.warn(
        `Database unavailable: ${exception instanceof Error ? exception.message : String(exception)}`,
      );
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: statusText(HttpStatus.SERVICE_UNAVAILABLE),
        message: 'A dependency is temporarily unavailable. Please retry.',
        code: ErrorCode.DependencyUnavailable,
        retryable: true,
      };
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: statusText(HttpStatus.INTERNAL_SERVER_ERROR),
      message: 'An unexpected error occurred.',
      code: ErrorCode.InternalError,
    };
  }

  private fromHttpException(exception: HttpException): ErrorResponseBody {
    const statusCode = exception.getStatus();
    const raw = exception.getResponse();
    const details: {
      message?: unknown;
      code?: unknown;
      violations?: unknown;
      retryable?: unknown;
    } = typeof raw === 'object' && raw !== null ? raw : { message: raw };

    const message = Array.isArray(details.message)
      ? details.message.join('; ')
      : typeof details.message === 'string'
        ? details.message
        : exception.message;

    const body: ErrorResponseBody = {
      statusCode,
      error: statusText(statusCode),
      message,
      code:
        typeof details.code === 'string'
          ? details.code
          : (DEFAULT_CODES[statusCode] ??
            (statusCode >= 500 ? ErrorCode.InternalError : ErrorCode.BadRequest)),
    };

    if (Array.isArray(details.violations)) {
      body.violations = details.violations as FieldViolation[];
    }
    if (
      details.retryable === true ||
      statusCode === HttpStatus.SERVICE_UNAVAILABLE
    ) {
      body.retryable = true;
    }
    return body;
  }
}
