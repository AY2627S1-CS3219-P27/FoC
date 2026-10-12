import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type DataSource, QueryFailedError } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  Building,
  Category,
  SupplierCategory,
  SupplierKind,
} from '../database/entities/index.js';
import { SuppliersService } from './suppliers.service.js';

const BUILDING_ID = '6f1c2e0a-8d4b-4d3e-b1a2-9c8d7e6f5a41';
const FOOD_ID = '0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11';
const COFFEE_ID = '1c8f7d9b-4a1f-4d4a-8b66-3b0e1c8e2d22';

const VALID = {
  name: 'Cool Spot',
  kind: SupplierKind.Store,
  categoryIds: [FOOD_ID],
  buildingId: BUILDING_ID,
  floor: '1',
  locationDescription: 'Next to LT19',
  coordinates: { latitude: 1.2951, longitude: 103.7737 },
};

const CAMPUS: Record<string, number> = {
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
};

function setup(
  options: {
    building?: Partial<Building> | null;
    categories?: Partial<Category>[];
    saveError?: unknown;
  } = {},
) {
  const building =
    options.building === undefined
      ? { id: BUILDING_ID, retiredAt: null }
      : options.building;
  const categories = options.categories ?? [{ id: FOOD_ID, retiredAt: null }];

  const manager = {
    findOneBy: vi.fn(async (entity: unknown) =>
      entity === Building ? building : null,
    ),
    findBy: vi.fn(async (entity: unknown) =>
      entity === Category ? categories : [],
    ),
    create: vi.fn((_entity: unknown, values: object) => ({ ...values })),
    save: vi.fn(async (values: object) => {
      if (options.saveError) {
        throw options.saveError;
      }
      return { ...values, version: 1 };
    }),
    insert: vi.fn(async () => undefined),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;
  const config = {
    get: (key: string) => CAMPUS[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;

  const suppliersRepo = {
    createQueryBuilder: vi.fn(() => ({
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn(async () => []),
    })),
    findOne: vi.fn(async () => null),
  } as any;

  return { service: new SuppliersService(dataSource, suppliersRepo, config), manager };
}

async function violationsOf(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse() as {
    code: string;
    violations: { field: string; reason: string }[];
  };
}

describe('SuppliersService.create', () => {
  it('saves an Active supplier with its normalised key and category links', async () => {
    const { service, manager } = setup();

    const saved = await service.create({ ...VALID, name: '  Cool   Spot ' });

    expect(saved).toMatchObject({
      name: 'Cool   Spot',
      nameKey: 'cool spot',
      status: 'Active',
      version: 1,
      photoUrl: null,
    });
    expect(manager.insert).toHaveBeenCalledWith(SupplierCategory, [
      { supplierId: saved.id, categoryId: FOOD_ID },
    ]);
  });

  it('reports field errors and missing references together (F1.6.1)', async () => {
    const { service, manager } = setup({ building: null, categories: [] });

    const body = await violationsOf(
      service.create({ ...VALID, floor: 'Z', categoryIds: [COFFEE_ID] }),
    );

    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.violations.map((violation) => violation.field)).toEqual(
      expect.arrayContaining(['floor', 'buildingId', 'categoryIds']),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a retired building or category for new values (F1.8)', async () => {
    const { service } = setup({
      building: { id: BUILDING_ID, retiredAt: new Date() },
      categories: [{ id: FOOD_ID, retiredAt: new Date() }],
    });

    const body = await violationsOf(service.create(VALID));

    expect(body.violations).toEqual([
      {
        field: 'buildingId',
        reason: 'building is retired and cannot be chosen',
      },
      {
        field: 'categoryIds',
        reason: `category ${FOOD_ID} is retired and cannot be chosen`,
      },
    ]);
  });

  it('turns the duplicate constraint firing into 409 DUPLICATE_SUPPLIER', async () => {
    const duplicate = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'UQ_suppliers_name_key_building_floor',
      }),
    );
    const { service } = setup({ saveError: duplicate });

    const error = await service.create(VALID).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_SUPPLIER',
    });
  });

  it('passes other database failures through untouched', async () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const { service } = setup({ saveError: outage });

    await expect(service.create(VALID)).rejects.toBe(outage);
  });
});
