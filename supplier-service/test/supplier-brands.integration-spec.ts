import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BrandsService } from '../src/brands/brands.service.js';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  Brand,
  Building,
  BuildingNameKey,
  Category,
  SupplierKind,
} from '../src/database/entities/index.js';
import { ListSuppliersQueryDto } from '../src/suppliers/dto/list-suppliers-query.dto.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

const VALUES: Record<string, unknown> = {
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
  PLACEHOLDER_IMAGE_URL: '',
};
const config = {
  get: (key: string) => VALUES[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

const query = (values: Partial<ListSuppliersQueryDto> = {}) =>
  Object.assign(new ListSuppliersQueryDto(), values);

describe('brands when reading suppliers (real PostgreSQL, F5.1, F5.4.1, F5.4.6, F5.8)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let brands: BrandsService;
  let com2: Building;
  let com3: Building;
  let food: Category;
  let cheers: Brand;
  let coconut: Brand;

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

    suppliers = new SuppliersService(dataSource, config);
    queries = new SupplierQueriesService(dataSource, config);
    brands = new BrandsService(dataSource.getRepository(Brand));
    const buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    com2 = await buildings.create({
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases: [],
      latitude: 1.2939,
      longitude: 103.7742,
    });
    com3 = await buildings.create({
      canonicalName: 'Computing 3',
      shortName: 'COM3',
      aliases: [],
      latitude: 1.2944,
      longitude: 103.7726,
    });
    food = await new CategoriesService(
      dataSource.getRepository(Category),
    ).create('Food');
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals,
               suppliers, brands
    `);
    cheers = await brands.create('Cheers');
    coconut = await brands.create('Mr Coconut');
    // Two Cheers outlets in different buildings, one Mr Coconut, one independent.
    await add('Cheers E3', cheers, com2);
    await add('Cheers Terrace', cheers, com3);
    await add('Coconut Stall', coconut, com2);
    await add('Indie Cafe', null, com3);
  });

  const add = (name: string, brand: Brand | null, building: Building) =>
    suppliers.create({
      name,
      kind: SupplierKind.Store,
      categoryIds: [food.id],
      buildingId: building.id,
      floor: '1',
      locationDescription: 'Somewhere',
      coordinates: { latitude: 1.294, longitude: 103.7738 },
      ...(brand && { brandId: brand.id }),
    });

  const names = async (values: Partial<ListSuppliersQueryDto>) =>
    (await queries.list(query(values))).items.map((item) => item.name).sort();

  async function violationsOf(values: Partial<ListSuppliersQueryDto>) {
    const error = await queries
      .list(query(values))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as {
        violations: { field: string; reason: string }[];
      }
    ).violations;
  }

  describe('the brand on each supplier (F5.1)', () => {
    it('is {id, name} in the list, and null without one', async () => {
      const items = (await queries.list(query())).items;

      expect(
        Object.fromEntries(items.map((item) => [item.name, item.brand])),
      ).toEqual({
        'Cheers E3': { id: cheers.id, name: 'Cheers' },
        'Cheers Terrace': { id: cheers.id, name: 'Cheers' },
        'Coconut Stall': { id: coconut.id, name: 'Mr Coconut' },
        'Indie Cafe': null,
      });
    });

    it('is in the detail view too, and follows a rename', async () => {
      const [outlet] = (await queries.list(query({ name: 'Cheers E3' }))).items;
      await brands.rename(cheers.id, 'Cheers Plus');

      await expect(queries.get(outlet!.id)).resolves.toMatchObject({
        brand: { id: cheers.id, name: 'Cheers Plus' },
      });
      // One rename updated every outlet.
      const renamed = await names({ brandId: [cheers.id] });
      expect(renamed).toEqual(['Cheers E3', 'Cheers Terrace']);
    });

    it('still shows a brand that was retired later (F1.8)', async () => {
      await brands.retire(cheers.id);
      const [outlet] = (await queries.list(query({ name: 'Cheers E3' }))).items;

      expect(outlet!.brand).toEqual({ id: cheers.id, name: 'Cheers' });
      await expect(queries.get(outlet!.id)).resolves.toMatchObject({
        brand: { id: cheers.id, name: 'Cheers' },
      });
    });
  });

  describe('filtering by brand (F5.4.6)', () => {
    it('returns the suppliers of that brand', async () => {
      await expect(names({ brandId: [cheers.id] })).resolves.toEqual([
        'Cheers E3',
        'Cheers Terrace',
      ]);
    });

    it('matches any of several brands, repeated like the other filters', async () => {
      await expect(
        names({ brandId: [cheers.id, coconut.id] }),
      ).resolves.toEqual(['Cheers E3', 'Cheers Terrace', 'Coconut Stall']);
    });

    it('combines with the other filters (F5.5)', async () => {
      await expect(
        names({ brandId: [cheers.id], buildingId: [com3.id] }),
      ).resolves.toEqual(['Cheers Terrace']);
    });

    it('counts and pages only the matching suppliers (N3.1.3)', async () => {
      const first = await queries.list(
        query({ brandId: [cheers.id], limit: 1 }),
      );

      expect(first).toMatchObject({ total: 2, hasMore: true });
      expect(first.items).toHaveLength(1);
    });

    it('rejects a brand that does not exist, naming the field (F5.8)', async () => {
      await expect(
        violationsOf({ brandId: ['11111111-1111-4111-8111-111111111111'] }),
      ).resolves.toEqual([
        {
          field: 'brandId',
          reason: 'brand 11111111-1111-4111-8111-111111111111 does not exist',
        },
      ]);
    });

    it('returns nothing for a retired brand, though suppliers keep it (F5.8.1)', async () => {
      await brands.retire(cheers.id);

      const page = await queries.list(query({ brandId: [cheers.id] }));

      expect(page).toMatchObject({ items: [], total: 0, hasMore: false });
    });
  });

  describe('searching by name also matches the brand (F5.4.1)', () => {
    it("finds every outlet by the brand's name, whatever its own name", async () => {
      await add('Outlet Without The Word', cheers, com2);

      await expect(names({ name: 'cheers' })).resolves.toEqual([
        'Cheers E3',
        'Cheers Terrace',
        'Outlet Without The Word',
      ]);
    });

    it('matches part of a brand name, in any case', async () => {
      await expect(names({ name: 'COCO' })).resolves.toEqual(['Coconut Stall']);
      await expect(names({ name: 'r coc' })).resolves.toEqual([
        'Coconut Stall',
      ]);
    });

    it("still matches the supplier's own name, with or without a brand", async () => {
      await expect(names({ name: 'indie' })).resolves.toEqual(['Indie Cafe']);
      await expect(names({ name: 'stall' })).resolves.toEqual([
        'Coconut Stall',
      ]);
    });

    it("matches a retired brand's name on suppliers that keep it", async () => {
      await brands.retire(coconut.id);

      await expect(names({ name: 'mr coconut' })).resolves.toEqual([
        'Coconut Stall',
      ]);
    });

    it('treats wildcards in the search literally', async () => {
      await expect(names({ name: '%' })).resolves.toEqual([]);
    });

    it('combines the name search with the brand filter (F5.5)', async () => {
      await expect(
        names({ name: 'terrace', brandId: [cheers.id] }),
      ).resolves.toEqual(['Cheers Terrace']);
      await expect(
        names({ name: 'terrace', brandId: [coconut.id] }),
      ).resolves.toEqual([]);
    });
  });
});
