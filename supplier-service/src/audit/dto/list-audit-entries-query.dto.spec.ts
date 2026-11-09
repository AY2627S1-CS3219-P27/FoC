import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation/validation.pipe.js';
import { ListAuditEntriesQueryDto } from './list-audit-entries-query.dto.js';

const ID = '0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11';

function parse(query: Record<string, unknown>) {
  return createValidationPipe().transform(query, {
    type: 'query',
    metatype: ListAuditEntriesQueryDto,
  }) as Promise<ListAuditEntriesQueryDto>;
}

async function violations(query: Record<string, unknown>) {
  const error = await parse(query).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (
    (error as BadRequestException).getResponse() as {
      violations: { field: string }[];
    }
  ).violations.map((violation) => violation.field);
}

describe('ListAuditEntriesQueryDto', () => {
  it('defaults to offset 0 and limit 25 (N3.1.2)', async () => {
    await expect(parse({})).resolves.toMatchObject({ offset: 0, limit: 25 });
  });

  it('reads every filter, lower-casing the ids', async () => {
    await expect(
      parse({
        targetType: 'supplier',
        targetId: ID.toUpperCase(),
        actorId: ID.toUpperCase(),
        action: 'supplier.updated',
        offset: '10',
        limit: '5',
      }),
    ).resolves.toMatchObject({
      targetType: 'supplier',
      targetId: ID,
      actorId: ID,
      action: 'supplier.updated',
      offset: 10,
      limit: 5,
    });
  });

  it.each([
    ['an unknown target type', { targetType: 'widget' }, ['targetType']],
    ['a malformed target id', { targetId: 'x' }, ['targetId']],
    ['a malformed actor id', { actorId: 'x' }, ['actorId']],
    ['an over-long action', { action: 'a'.repeat(65) }, ['action']],
    ['a limit over 1000', { limit: '5000' }, ['limit']],
    ['a negative offset', { offset: '-1' }, ['offset']],
    ['an unknown parameter', { colour: 'red' }, ['colour']],
  ])('refuses %s', async (_, query, fields) => {
    expect(new Set(await violations(query))).toEqual(new Set(fields));
  });
});
