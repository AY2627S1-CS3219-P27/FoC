import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation/validation.pipe.js';
import { DenyRequestDto } from './deny-request.dto.js';
import { ListRequestsQueryDto } from './list-requests-query.dto.js';

/** Runs a raw value through the same pipe as production. */
function parse<T>(
  metatype: new () => T,
  type: 'body' | 'query',
  value: Record<string, unknown>,
) {
  return createValidationPipe().transform(value, {
    type,
    metatype,
  }) as Promise<T>;
}

async function violations(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  const body = (error as BadRequestException).getResponse() as {
    violations: { field: string }[];
  };
  return body.violations.map((violation) => violation.field);
}

describe('DenyRequestDto (F6.4)', () => {
  const deny = (value: Record<string, unknown>) =>
    parse(DenyRequestDto, 'body', value);

  it('trims the reason', async () => {
    await expect(deny({ reason: '  Closed down  ' })).resolves.toMatchObject({
      reason: 'Closed down',
    });
  });

  it.each([
    ['missing', {}],
    ['blank', { reason: '   ' }],
    ['not a string', { reason: 5 }],
    ['over 500 characters', { reason: 'x'.repeat(501) }],
  ])('refuses a reason that is %s', async (_, value) => {
    expect(new Set(await violations(deny(value)))).toEqual(new Set(['reason']));
  });

  it('accepts exactly 500 characters', async () => {
    await expect(deny({ reason: 'x'.repeat(500) })).resolves.toBeDefined();
  });
});

describe('ListRequestsQueryDto (F6.7)', () => {
  const list = (value: Record<string, unknown>) =>
    parse(ListRequestsQueryDto, 'query', value);

  it('defaults to offset 0 and limit 25 (N3.1.2)', async () => {
    await expect(list({})).resolves.toMatchObject({ offset: 0, limit: 25 });
  });

  it('accepts a request type', async () => {
    await expect(list({ type: 'Create' })).resolves.toMatchObject({
      type: 'Create',
    });
  });

  it('refuses an unknown type and a bad page', async () => {
    await expect(
      violations(list({ type: 'Delete', offset: '-1', limit: '0' })),
    ).resolves.toEqual(expect.arrayContaining(['type', 'offset', 'limit']));
  });
});
