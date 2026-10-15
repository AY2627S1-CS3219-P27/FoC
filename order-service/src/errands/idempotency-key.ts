import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { Request } from 'express';

// Header the client sends to make a retried request safe. Node lowercases
// incoming header names.
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

// 1-255 visible ASCII characters, no spaces: enough for a uuid or any
// client-made token, and safe to store and log.
const VALID_KEY = /^[\x21-\x7E]{1,255}$/;

// No header means no key (keys are optional). A header that is present but
// empty, too long or holds other characters is a client bug: 400, not "no key".
@Injectable()
export class IdempotencyKeyPipe
  implements PipeTransform<string | undefined, string | undefined>
{
  transform(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (!VALID_KEY.test(value)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message:
          'Idempotency-Key must be 1 to 255 visible ASCII characters with no spaces.',
      });
    }
    return value;
  }
}

// @Headers() takes no pipes, so read the header in a custom decorator instead.
const idempotencyKeyHeader = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const value = ctx.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_KEY_HEADER];
    // Node joins a repeated header into "a, b"; the space makes the pipe refuse it.
    // (The type allows a list too, for set-cookie only; treat it the same way.)
    return Array.isArray(value) ? value.join(', ') : value;
  },
);

// Route parameter: the checked key, or undefined when the client sent none.
export const IdempotencyKey = () => idempotencyKeyHeader(IdempotencyKeyPipe);
