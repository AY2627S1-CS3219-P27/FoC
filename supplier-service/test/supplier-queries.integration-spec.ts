import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
  SupplierCategory,
} from '../src/database/entities/index.js';
import { SupplierSeedService } from '../src/seed/supplier-seed.service.js';
import { ListSuppliersQueryDto } from '../src/suppliers/dto/list-suppliers-query.dto.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

function config(
  extra: Record<string, unknown> = {},
): ConfigService<EnvironmentVariables, true> {
  const values: Record<string, unknown> = {
    CAMPUS_MIN_LATITUDE: 1.28,
    CAMPUS_MAX_LATITUDE: 1.31,
    CAMPUS_MIN_LONGITUDE: 103.74,
    CAMPUS_MAX_LONGITUDE: 103.79,
    PLACEHOLDER_IMAGE_URL: '',
    ...extra,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

/** A query as the validation pipe would produce it (defaults applied). */
function query(
  values: Partial<ListSuppliersQueryDto> = {},
): ListSuppliersQueryDto {
  return Object.assign(new ListSuppliersQueryDto(), values);
}

describe('supplier listing and lookup (real PostgreSQL, seeded)', () => {
  let dataSource: DataSource;
  let queries: SupplierQueriesService;
  let buildings: BuildingsService;
  let categories: CategoriesService;

  const buildingId = async (name: string) =>
    (await buildings.resolve(name))!.id;
  const categoryId = async (name: string) =>
    (await categories.findActiveByName(name))!.id;
  const names = (page: { items: { name: string }[] }) =>
    page.items.map((item) => item.name);

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
    const seed = new SupplierSeedService(
      config(),
      buildings,
      categories,
      new SuppliersService(dataSource, config()),
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    await seed.importSeed(readFileSync('../data/csv/supplier-seed-data.csv'));
    vi.restoreAllMocks();

    queries = new SupplierQueriesService(dataSource, config());
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  describe('listing (F5, N3.1)', () => {
    it('returns the first page with pagination metadata (N3.1.3)', async () => {
      const page = await queries.list(query());

      expect(page).toMatchObject({
        total: 21,
        offset: 0,
        limit: 25,
        hasMore: false,
      });
      expect(page.items).toHaveLength(21);
      expect(page.items[0]).toEqual({
        id: expect.any(String),
        displayName: expect.stringMatching(/ @ /),
        name: expect.any(String),
        brand: null,
        kind: expect.any(String),
        categories: expect.any(Array),
        building: { id: expect.any(String), shortName: expect.any(String) },
        floor: expect.any(String),
        status: 'Active',
        isOpenNow: null,
        thumbnailUrl: expect.toBeOneOf([expect.any(String), null]),
      });
    });

    it('sorts by display name, then id, by default (F5.3)', async () => {
      const expected = await dataSource.query<{ id: string }[]>(`
        SELECT s.id FROM suppliers s JOIN buildings b ON b.id = s.building_id
        ORDER BY s.name_key || ' @ ' || lower(b.short_name), s.id
      `);
      const page = await queries.list(query());

      expect(page.items.map((item) => item.id)).toEqual(
        expected.map((row) => row.id),
      );
    });

    it('pages stably: consecutive pages add up to the full list', async () => {
      const full = await queries.list(query());
      const pages = [];
      for (let offset = 0; offset < 21; offset += 5) {
        pages.push(...(await queries.list(query({ offset, limit: 5 }))).items);
      }

      expect(pages.map((item) => item.id)).toEqual(
        full.items.map((item) => item.id),
      );
    });

    it('reports hasMore until the last page (N3.1.3)', async () => {
      await expect(
        queries.list(query({ offset: 0, limit: 5 })),
      ).resolves.toMatchObject({ total: 21, hasMore: true });

      const last = await queries.list(query({ offset: 20, limit: 5 }));
      expect(last).toMatchObject({ total: 21, offset: 20, hasMore: false });
      expect(last.items).toHaveLength(1);
    });

    it('accepts the largest page size (N3.1.1)', async () => {
      await expect(queries.list(query({ limit: 1000 }))).resolves.toMatchObject(
        { total: 21, hasMore: false },
      );
    });

    it('returns an empty page, not an error, when nothing matches (F5.6)', async () => {
      await expect(queries.list(query({ name: 'zzz' }))).resolves.toEqual({
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        hasMore: false,
      });
    });
  });

  describe('filters (F5.4, F5.5)', () => {
    it('matches part of the name, ignoring case (F5.4.1)', async () => {
      const page = await queries.list(query({ name: 'CAFE' }));

      expect(names(page).sort()).toEqual(['Cafe+ Robot Cafe', 'Good Day Cafe']);
    });

    it('treats LIKE wildcards in the search as literal text', async () => {
      await expect(queries.list(query({ name: '%' }))).resolves.toMatchObject({
        total: 0,
      });
      await expect(queries.list(query({ name: '_' }))).resolves.toMatchObject({
        total: 0,
      });
    });

    it('matches suppliers having any of the categories (F5.4.2)', async () => {
      const coffee = await categoryId('Coffee');
      const printing = await categoryId('Printing');

      await expect(
        queries.list(query({ categoryId: [coffee] })),
      ).resolves.toMatchObject({ total: 5 });
      await expect(
        queries.list(query({ categoryId: [coffee, printing] })),
      ).resolves.toMatchObject({ total: 7 });
    });

    it('accepts filter ids written in upper case (review #605)', async () => {
      const coffee = await categoryId('Coffee');
      await expect(
        queries.list(
          Object.assign(new ListSuppliersQueryDto(), {
            categoryId: [coffee.toUpperCase()],
          }),
        ),
      ).resolves.toMatchObject({ total: 5 });
    });

    it('finds suppliers by building, i.e. by location (F5.4.3)', async () => {
      const page = await queries.list(
        query({ buildingId: [await buildingId('PGP')] }),
      );

      expect(names(page).sort()).toEqual([
        'A Hot Hideout',
        'Octobox',
        'Supersnacks',
      ]);
    });

    it('filters by kind (F5.4.4)', async () => {
      const page = await queries.list(query({ kind: ['Facility'] as never }));
      expect(names(page)).toEqual(['Printer']);
    });

    it('combines filters with AND (F5.5)', async () => {
      const page = await queries.list(
        query({
          buildingId: [await buildingId('PGP')],
          categoryId: [await categoryId('Shopping')],
        }),
      );
      expect(names(page)).toEqual(['Octobox']);
    });

    it('includes Inactive suppliers unless filtered by status (F5.4.5, F5.7)', async () => {
      await dataSource.query(
        `UPDATE suppliers SET status = 'Inactive' WHERE name = 'Octobox'`,
      );
      try {
        await expect(queries.list(query())).resolves.toMatchObject({
          total: 21,
        });
        await expect(
          queries.list(query({ status: 'Active' as never })),
        ).resolves.toMatchObject({ total: 20 });
        const inactive = await queries.list(
          query({ status: 'Inactive' as never }),
        );
        expect(names(inactive)).toEqual(['Octobox']);
        expect(inactive.items[0].status).toBe('Inactive');
      } finally {
        await dataSource.query(
          `UPDATE suppliers SET status = 'Active' WHERE name = 'Octobox'`,
        );
      }
    });

    it('rejects unknown category and building ids, listing both (F5.8)', async () => {
      const error = await queries
        .list(
          query({
            categoryId: ['00000000-0000-4000-8000-000000000001'],
            buildingId: ['00000000-0000-4000-8000-000000000002'],
          }),
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        violations: [
          {
            field: 'categoryId',
            reason: expect.stringContaining('does not exist'),
          },
          {
            field: 'buildingId',
            reason: expect.stringContaining('does not exist'),
          },
        ],
      });
    });

    it('returns nothing for a retired category, though suppliers keep it (F5.8.1, F1.8)', async () => {
      const retired = await categories.create('Late Night');
      const coolSpot = await dataSource
        .getRepository(Supplier)
        .findOneByOrFail({ name: 'Cool Spot' });
      await dataSource
        .getRepository(SupplierCategory)
        .insert({ supplierId: coolSpot.id, categoryId: retired.id });
      await categories.retire(retired.id);

      await expect(
        queries.list(query({ categoryId: [retired.id] })),
      ).resolves.toMatchObject({ total: 0, items: [] });
      // Mixed with an in-use category, only the in-use one matches.
      await expect(
        queries.list(
          query({ categoryId: [retired.id, await categoryId('Printing')] }),
        ),
      ).resolves.toMatchObject({ total: 2 });
      // The supplier still shows the retired category it already had.
      const detail = await queries.get(coolSpot.id);
      expect(detail.categories.map((c) => c.name)).toContain('Late Night');
    });
  });

  describe('sorting (F5.3.1)', () => {
    it('sorts by name either way, id breaking ties', async () => {
      const asc = await queries.list(query({ sort: 'name' }));
      const desc = await queries.list(query({ sort: 'name', order: 'desc' }));

      expect(desc.items.map((i) => i.id)).toEqual(
        asc.items.map((i) => i.id).reverse(),
      );
    });

    it('sorts by building', async () => {
      const page = await queries.list(query({ sort: 'building' }));
      const expected = await dataSource.query<{ id: string }[]>(`
        SELECT s.id FROM suppliers s JOIN buildings b ON b.id = s.building_id
        ORDER BY lower(b.short_name), s.name_key, s.id
      `);
      expect(page.items.map((i) => i.id)).toEqual(expected.map((r) => r.id));
    });

    it('sorts by created and last-updated time', async () => {
      const created = await queries.list(query({ sort: 'createdAt' }));
      const expected = await dataSource.query<{ id: string }[]>(
        `SELECT id FROM suppliers ORDER BY created_at DESC, id`,
      );
      const createdDesc = await queries.list(
        query({ sort: 'createdAt', order: 'desc' }),
      );
      const updated = await queries.list(query({ sort: 'updatedAt' }));

      expect(createdDesc.items.map((i) => i.id)).toEqual(
        expected.map((r) => r.id),
      );
      expect(created.total).toBe(21);
      expect(updated.total).toBe(21);
    });
  });

  describe('single lookup (F5.9, F15.1)', () => {
    it('returns every field, including the version', async () => {
      const coolSpot = await dataSource
        .getRepository(Supplier)
        .findOneByOrFail({ name: 'Cool Spot' });

      const detail = await queries.get(coolSpot.id);

      expect(detail).toMatchObject({
        id: coolSpot.id,
        displayName: 'Cool Spot @ COM2',
        name: 'Cool Spot',
        kind: 'Store',
        building: {
          shortName: 'COM2',
          canonicalName: 'Computing 2',
        },
        floor: '1',
        locationDescription: 'Opp LT16',
        coordinates: { latitude: 1.2940156, longitude: 103.7738478 },
        status: 'Active',
        openingHours: null,
        nextChangeAt: null,
        version: 1,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(detail.images?.original).toMatch(/COOL_SPOT\.jpeg$/);
    });

    it('returns null images when there is no photo and no placeholder', async () => {
      const nami = await dataSource
        .getRepository(Supplier)
        .findOneByOrFail({ name: 'Nami' });

      const detail = await queries.get(nami.id);

      expect(detail.images).toBeNull();
      expect(detail.thumbnailUrl).toBeNull();
    });

    it('returns the configured placeholder when there is no photo (F1.2.9)', async () => {
      const withPlaceholder = new SupplierQueriesService(
        dataSource,
        config({ PLACEHOLDER_IMAGE_URL: 'https://example.com/no-photo.png' }),
      );
      const nami = await dataSource
        .getRepository(Supplier)
        .findOneByOrFail({ name: 'Nami' });

      const detail = await withPlaceholder.get(nami.id);

      expect(detail.thumbnailUrl).toBe('https://example.com/no-photo.png');
      expect(detail.images).toEqual({
        original: 'https://example.com/no-photo.png',
        thumbnail: 'https://example.com/no-photo.png',
      });
    });

    it('answers a distinct not-found for an unknown id (F5.9.1)', async () => {
      const error = await queries
        .get('00000000-0000-4000-8000-000000000003')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'SUPPLIER_NOT_FOUND',
      });
    });
  });
});
