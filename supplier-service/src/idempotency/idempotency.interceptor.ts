import type { AuthenticatedRequest } from '@foc/auth';
import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import type { Response } from 'express';
import {
  catchError,
  from,
  map,
  mergeMap,
  type Observable,
  of,
  throwError,
} from 'rxjs';
import { ErrorCode } from '../common/errors/error-response.js';
import { requestFingerprint } from './fingerprint.js';
import { IdempotencyService } from './idempotency.service.js';

/** 1-255 printable characters, no control characters. */
const KEY_PATTERN = /^[\x20-\x7e]{1,255}$/;
/** The headers of a create's answer worth replaying. */
const REPLAYED_HEADERS = ['Location', 'ETag'] as const;

/**
 * Makes a create endpoint safe to repeat (F14.2). Without an
 * `Idempotency-Key` header the request runs as usual. With one, the same
 * user repeating the same request within 24 hours gets the original answer
 * without anything being done again (F14.2.1); the same key for a different
 * request is refused (F14.2.2). Only a success is stored: a failed attempt
 * releases the key, so a corrected retry can use it.
 *
 * Guards run before an interceptor, so an unauthenticated request is 401
 * before its key is looked at, and the user is always the token's `sub`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotency: IdempotencyService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const key = request.header('idempotency-key');
    if (key === undefined) {
      return next.handle();
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Request validation failed.',
        violations: [
          {
            field: 'Idempotency-Key',
            reason: 'must be 1-255 printable characters',
          },
        ],
      });
    }

    const userId = request.user.sub.toLowerCase();
    const begun = await this.idempotency.begin(
      userId,
      key,
      requestFingerprint({
        method: request.method,
        path: request.path,
        body: request.body,
        ifMatch: request.header('if-match'),
      }),
    );

    switch (begun.kind) {
      case 'mismatch':
        throw new UnprocessableEntityException({
          code: ErrorCode.IdempotencyKeyReused,
          message:
            'This Idempotency-Key was already used for a different request. Use a new key for a new request.',
        });
      case 'in-progress':
        response.setHeader('Retry-After', '1');
        throw new ConflictException({
          code: ErrorCode.IdempotencyInProgress,
          message:
            'A request with this Idempotency-Key is still running. Retry shortly.',
        });
      case 'replay':
        response.setHeader('Idempotent-Replayed', 'true');
        for (const [name, value] of Object.entries(begun.outcome.headers)) {
          response.setHeader(name, value);
        }
        return of(begun.outcome.body);
      case 'run':
        break;
    }

    const { claimId } = begun;
    // Nest applies the status after the interceptors, so read it from the
    // handler's @HttpCode, or the default for the method.
    const statusCode =
      (Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
        number | undefined) ?? (request.method === 'POST' ? 201 : 200);

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(this.store(userId, key, claimId, response, statusCode, body)).pipe(
          map(() => body),
        ),
      ),
      catchError((error: unknown) =>
        from(this.release(userId, key, claimId)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /**
   * Stores the success. If that fails, the answer still goes out: the claim
   * goes stale after a minute and a retry runs again (the unique constraints
   * refuse a double create).
   */
  private async store(
    userId: string,
    key: string,
    claimId: string,
    response: Response,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    const headers: Record<string, string> = {};
    for (const name of REPLAYED_HEADERS) {
      const value = response.getHeader(name);
      if (value !== undefined) {
        headers[name] = String(value);
      }
    }
    try {
      await this.idempotency.complete(userId, key, claimId, {
        statusCode,
        headers,
        body: JSON.parse(JSON.stringify(body ?? null)) as unknown,
      });
    } catch (error) {
      this.logger.warn(
        `could not store the outcome of an idempotency key: ${String(error)}`,
      );
    }
  }

  private async release(
    userId: string,
    key: string,
    claimId: string,
  ): Promise<void> {
    try {
      await this.idempotency.release(userId, key, claimId);
    } catch (error) {
      this.logger.warn(
        `could not release an idempotency key: ${String(error)}`,
      );
    }
  }
}
