import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation/validation.pipe.js';
import { DenyRequestDto } from './deny-request.dto.js';
import { ListRequestsQueryDto } from './list-requests-query.dto.js';
import { SubmitStatusChangeRequestDto } from './submit-status-change-request.dto.js';

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

describe('SubmitStatusChangeRequestDto (F9.3)', () => {
  const submit = (value: Record<string, unknown>) =>
    parse(SubmitStatusChangeRequestDto, 'body', value);
  const id = '11111111-1111-4111-8111-111111111111';

  it('accepts a status without a reason, lower-casing the supplier id', async () => {
    await expect(
      submit({ supplierId: id.toUpperCase(), status: 'Inactive' }),
    ).resolves.toMatchObject({ supplierId: id, status: 'Inactive' });
  });

  it('trims the reason', async () => {
    await expect(
      submit({ supplierId: id, status: 'Active', reason: '  Reopened  ' }),
    ).resolves.toMatchObject({ reason: 'Reopened' });
  });

  it.each([
    ['a missing supplier id', { status: 'Active' }, ['supplierId']],
    [
      'a non-UUID supplier id',
      { supplierId: 'x', status: 'Active' },
      ['supplierId'],
    ],
    ['a missing status', { supplierId: id }, ['status']],
    ['an unknown status', { supplierId: id, status: 'Closed' }, ['status']],
    [
      'a blank reason',
      { supplierId: id, status: 'Active', reason: '   ' },
      ['reason'],
    ],
    [
      'a reason over 500 characters',
      { supplierId: id, status: 'Active', reason: 'x'.repeat(501) },
      ['reason'],
    ],
  ])('refuses %s', async (_, value, fields) => {
    expect(new Set(await violations(submit(value)))).toEqual(new Set(fields));
  });
});
