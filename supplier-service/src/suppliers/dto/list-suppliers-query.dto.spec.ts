import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation/validation.pipe.js';
import { ListSuppliersQueryDto } from './list-suppliers-query.dto.js';

const FOOD = '0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11';
const COFFEE = '1c8f7d9b-4a1f-4d4a-8b66-3b0e1c8e2d22';

/** Runs a raw query object through the same pipe as production. */
function parse(query: Record<string, unknown>) {
  return createValidationPipe().transform(query, {
    type: 'query',
    metatype: ListSuppliersQueryDto,
  }) as Promise<ListSuppliersQueryDto>;
}

async function violations(query: Record<string, unknown>) {
  const error = await parse(query).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  const body = (error as BadRequestException).getResponse() as {
    violations: { field: string }[];
  };
  return body.violations.map((violation) => violation.field);
}

describe('ListSuppliersQueryDto', () => {
  it('defaults to offset 0 and limit 25 (N3.1.2)', async () => {
    await expect(parse({})).resolves.toMatchObject({ offset: 0, limit: 25 });
  });

  it('turns query strings into numbers and single values into arrays', async () => {
    await expect(
      parse({ offset: '50', limit: '10', categoryId: FOOD, kind: 'Store' }),
    ).resolves.toMatchObject({
      offset: 50,
      limit: 10,
      categoryId: [FOOD],
      kind: ['Store'],
    });
  });

  it('keeps repeated parameters as a list', async () => {
    await expect(
      parse({ categoryId: [FOOD, COFFEE], kind: ['Store', 'Facility'] }),
    ).resolves.toMatchObject({
      categoryId: [FOOD, COFFEE],
      kind: ['Store', 'Facility'],
    });
  });

  it('lower-cases ids, so upper-case UUIDs match (review #605)', async () => {
    await expect(
      parse({
        categoryId: FOOD.toUpperCase(),
        buildingId: [COFFEE.toUpperCase()],
      }),
    ).resolves.toMatchObject({ categoryId: [FOOD], buildingId: [COFFEE] });
  });

  it('treats a blank name as no name filter', async () => {
    const query = await parse({ name: '   ' });
    expect(query.name).toBeUndefined();
  });

  it('rejects unknown parameters instead of ignoring them (F5.8)', async () => {
    await expect(violations({ colour: 'red' })).resolves.toEqual(['colour']);
  });

  it('lists every malformed parameter at once', async () => {
    await expect(
      violations({
        categoryId: 'food',
        buildingId: ['not-a-uuid'],
        kind: 'Shop',
        status: 'Open',
        sort: 'price',
        order: 'up',
        offset: '-1',
        limit: '5000',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        'categoryId',
        'buildingId',
        'kind',
        'status',
        'sort',
        'order',
        'offset',
        'limit',
      ]),
    );
  });

  it('accepts the largest allowed page (N3.1.1)', async () => {
    await expect(parse({ limit: '1000' })).resolves.toMatchObject({
      limit: 1000,
    });
  });
});
