import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  Building,
  BuildingNameKey,
  Category,
  Supplier,
  SupplierKind,
} from '../src/database/entities/index.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

const CAMPUS: Record<string, number> = {
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
};

describe('supplier schema (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let buildings: BuildingsService;
  let categories: CategoriesService;
  let suppliers: SuppliersService;

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });

    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    categories = new CategoriesService(dataSource.getRepository(Category));
    suppliers = new SuppliersService(dataSource, dataSource.getRepository(Supplier), {
      get: (key: string) => CAMPUS[key],
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_categories, suppliers, categories,
               building_name_keys, buildings
    `);
  });

  async function com3() {
    return buildings.create({
      canonicalName: 'Computing 3',
      shortName: 'COM3',
      aliases: ['Com 3', 'Terrace'],
      latitude: 1.2949,
      longitude: 103.7743,
    });
  }

  async function supplierInput() {
    const building = await com3();
    const food = await categories.create('Food');
    return {
      name: 'Cool Spot',
      kind: SupplierKind.Store,
      categoryIds: [food.id],
      buildingId: building.id,
      floor: '1',
      locationDescription: 'Next to the lift',
      coordinates: { latitude: 1.2951, longitude: 103.7737 },
    };
  }

  describe('migration', () => {
    it('matches the entities exactly (no schema drift)', async () => {
      const pending = await dataSource.driver.createSchemaBuilder().log();
      expect(pending.upQueries.map((query) => query.query)).toEqual([]);
    });

    it('creates the named constraints the service relies on', async () => {
      const constraints = await dataSource.query<{ conname: string }[]>(`
        SELECT conname FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
      `);
      expect(constraints.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'PK_building_name_keys',
          'UQ_suppliers_name_key_building_floor',
          'CHK_suppliers_floor',
          'FK_suppliers_building',
          'FK_supplier_categories_category',
        ]),
      );
    });
  });

  describe('database rules (checked below the service)', () => {
    it('rejects a malformed floor and out-of-range coordinates', async () => {
      const building = await com3();
      const insert = (floor: string, latitude: number) =>
        dataSource.query(
          `INSERT INTO suppliers (id, name, name_key, kind, building_id, floor,
             location_description, latitude, longitude)
           VALUES (gen_random_uuid(), 'X', 'x', 'Store', $1, $2, 'here', $3, 103.77)`,
          [building.id, floor, latitude],
        );

      await expect(insert('01', 1.29)).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'CHK_suppliers_floor' },
      });
      await expect(insert('1', 91)).rejects.toMatchObject({
        driverError: { code: '23514', constraint: 'CHK_suppliers_latitude' },
      });
    });
  });

  describe('suppliers', () => {
    it('creates an Active supplier at version 1 with its categories', async () => {
      const saved = await suppliers.create(await supplierInput());

      const stored = await dataSource.getRepository(Supplier).findOneOrFail({
        where: { id: saved.id },
        relations: { categoryLinks: true },
      });
      expect(stored).toMatchObject({
        name: 'Cool Spot',
        nameKey: 'cool spot',
        status: 'Active',
        version: 1,
      });
      expect(stored.categoryLinks).toHaveLength(1);
    });

    it('lets exactly one of two concurrent identical submissions win (F1.5.2)', async () => {
      const input = await supplierInput();

      const results = await Promise.allSettled([
        suppliers.create(input),
        suppliers.create({ ...input, name: '  COOL   spot ' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );
      expect(await dataSource.getRepository(Supplier).count()).toBe(1);
    });

    it('allows the same name on another floor', async () => {
      const input = await supplierInput();
      await suppliers.create(input);

      await expect(
        suppliers.create({ ...input, floor: '2' }),
      ).resolves.toMatchObject({ floor: '2' });
    });

    it('persists nothing when a category does not exist', async () => {
      const input = await supplierInput();

      await expect(
        suppliers.create({
          ...input,
          categoryIds: ['00000000-0000-4000-8000-000000000000'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await dataSource.getRepository(Supplier).count()).toBe(0);
    });

    it('keeps a retired building on existing suppliers but refuses it for new ones (F1.8)', async () => {
      const input = await supplierInput();
      const existing = await suppliers.create(input);
      await buildings.retire(input.buildingId);

      await expect(
        dataSource.getRepository(Supplier).findOneBy({ id: existing.id }),
      ).resolves.toMatchObject({ buildingId: input.buildingId });
      await expect(
        suppliers.create({ ...input, floor: '3' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('buildings', () => {
    it('resolves any spelling, ignoring case and spaces (F4.5)', async () => {
      const building = await com3();

      await expect(buildings.resolve('terrace')).resolves.toMatchObject({
        id: building.id,
      });
      await expect(buildings.resolve('COM 3')).resolves.toMatchObject({
        id: building.id,
      });
      await expect(buildings.resolve('COM4')).resolves.toBeNull();
    });

    it('refuses a name already used by another in-use building (F4.2)', async () => {
      await com3();

      await expect(
        buildings.create({
          canonicalName: 'The Terrace',
          shortName: 'TRC',
          aliases: ['TERRACE'],
          latitude: 1.295,
          longitude: 103.774,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('frees a retired building’s names for reuse', async () => {
      const old = await com3();
      await buildings.retire(old.id);

      await expect(com3()).resolves.toMatchObject({ shortName: 'COM3' });
      await expect(buildings.listActive()).resolves.toHaveLength(1);
    });
  });

  describe('categories', () => {
    it('keeps names unique among in-use categories only (F11.2.1)', async () => {
      const food = await categories.create('Food');

      await expect(categories.create(' FOOD ')).rejects.toBeInstanceOf(
        ConflictException,
      );

      await categories.retire(food.id);
      await expect(categories.create('food')).resolves.toMatchObject({
        name: 'food',
      });
      await expect(categories.listActive()).resolves.toHaveLength(1);
    });
  });
});
