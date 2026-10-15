import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { IdempotencyKeyPipe } from './idempotency-key.js';

describe('IdempotencyKeyPipe', () => {
  const pipe = new IdempotencyKeyPipe();

  it('treats a missing header as no key', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it.each([
    ['a uuid', randomUUID()],
    ['one character', 'k'],
    ['255 characters', 'k'.repeat(255)],
    ['visible punctuation', 'order:42/retry_1'],
  ])('passes %s through unchanged', (_, key) => {
    expect(pipe.transform(key)).toBe(key);
  });

  it.each([
    ['an empty header', ''],
    ['256 characters', 'k'.repeat(256)],
    ['a space', 'my key'],
    ['a repeated header, joined by Node', 'k1, k2'],
    ['non-ASCII', 'clé'],
    ['a control character', 'k\t1'],
  ])('rejects %s with INVALID_IDEMPOTENCY_KEY', (_, key) => {
    let thrown: unknown;
    try {
      pipe.transform(key);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  });
});
