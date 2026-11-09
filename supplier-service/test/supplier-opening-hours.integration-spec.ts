import 'reflect-metadata';
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
  SupplierKind,
  SupplierStatus,
} from '../src/database/entities/index.js';
import { ListSuppliersQueryDto } from '../src/suppliers/dto/list-suppliers-query.dto.js';
import type { OpeningHours } from '../src/opening-hours/opening-hours.js';
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

/** An instant given in Singapore time. 2026-11-02 is a Monday. */
const sgt = (local: string) => new Date(`${local}+08:00`);

const query = (values: Partial<ListSuppliersQueryDto> = {}) =>
  Object.assign(new ListSuppliersQueryDto(), values);

describe('opening hours when reading suppliers (real PostgreSQL, F2.5, F5.4.7)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let com2: Building;
  let com3: Building;
  let food: Category;
  let now = sgt('2026-11-04T10:30:00'); // Wednesday

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
    queries = new SupplierQueriesService(dataSource, config, () => now);
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
    now = sgt('2026-11-04T10:30:00');
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals,
               suppliers
    `);
  });

  const add = (
    name: string,
    openingHours: OpeningHours | null | undefined,
    building = com2,
  ) =>
    suppliers.create({
      name,
      kind: SupplierKind.Store,
      categoryIds: [food.id],
      buildingId: building.id,
      floor: '1',
      locationDescription: 'Somewhere',
      coordinates: { latitude: 1.294, longitude: 103.7738 },
      ...(openingHours !== undefined && { openingHours }),
    });

  const weekdays: OpeningHours = {
    days: Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri'].map((day) => [
        day,
        [{ opens: '09:00', closes: '18:00' }],
      ]),
    ),
  };
  const nightOwl: OpeningHours = {
    days: { wed: [{ opens: '22:00', closes: '02:00' }] },
  };
  const sundayNight: OpeningHours = {
    days: { sun: [{ opens: '22:00', closes: '02:00' }] },
  };

  const openNames = async (extra: Partial<ListSuppliersQueryDto> = {}) =>
    (await queries.list(query({ openNow: true, ...extra }))).items.map(
      (item) => item.name,
    );

  describe('a single supplier (F2.5, F2.5.1)', () => {
    it('returns the hours, whether it is open now, and the next change', async () => {
      const { id } = await add('Weekday Cafe', weekdays);

      await expect(queries.get(id)).resolves.toMatchObject({
        openingHours: weekdays,
        isOpenNow: true,
        nextChangeAt: sgt('2026-11-04T18:00:00'),
      });
    });

    it('says when it opens next while closed', async () => {
      const { id } = await add('Weekday Cafe', weekdays);
      now = sgt('2026-11-07T12:00:00'); // Saturday

      await expect(queries.get(id)).resolves.toMatchObject({
        isOpenNow: false,
        nextChangeAt: sgt('2026-11-09T09:00:00'),
      });
    });

    it('is open and never changes when open around the clock (F2.2)', async () => {
      const { id } = await add('Always Open', { open24Hours: true });

      await expect(queries.get(id)).resolves.toMatchObject({
        openingHours: { open24Hours: true },
        isOpenNow: true,
        nextChangeAt: null,
      });
    });

    it('is not applicable without opening hours (F1.2.8, F2.5.1)', async () => {
      const { id } = await add('No Sign', undefined);

      await expect(queries.get(id)).resolves.toMatchObject({
        openingHours: null,
        isOpenNow: null,
        nextChangeAt: null,
      });
    });

    it('sees an overnight interval as open after midnight', async () => {
      const { id } = await add('Night Owl', nightOwl);
      now = sgt('2026-11-05T01:00:00'); // Thursday, opened Wednesday night

      await expect(queries.get(id)).resolves.toMatchObject({
        isOpenNow: true,
        nextChangeAt: sgt('2026-11-05T02:00:00'),
      });
    });
  });

  describe('the listing (F2.5)', () => {
    it('gives each item true, false or null', async () => {
      await add('Weekday Cafe', weekdays);
      await add('Night Owl', nightOwl);
      await add('No Sign', undefined);

      const items = (await queries.list(query())).items;

      expect(
        Object.fromEntries(items.map((i) => [i.name, i.isOpenNow])),
      ).toEqual({ 'Weekday Cafe': true, 'Night Owl': false, 'No Sign': null });
    });
  });

  describe('the openNow filter (F5.4.7)', () => {
    beforeEach(async () => {
      await add('Weekday Cafe', weekdays);
      await add('Always Open', { open24Hours: true });
      await add('Night Owl', nightOwl);
      await add('Monday Only', {
        days: { mon: [{ opens: '09:00', closes: '18:00' }] },
      });
      await add('No Sign', undefined);
      await add('Sunday Night', sundayNight);
    });

    it('keeps only suppliers open at that moment, leaving out those without hours', async () => {
      await expect(openNames()).resolves.toEqual([
        'Always Open',
        'Weekday Cafe',
      ]);
      const page = await queries.list(query({ openNow: true }));
      expect(page).toMatchObject({ total: 2, hasMore: false });
    });

    it('includes an interval that opened the evening before (F2.3)', async () => {
      now = sgt('2026-11-05T01:00:00'); // Thursday 01:00

      await expect(openNames()).resolves.toEqual(['Always Open', 'Night Owl']);
    });

    it('handles the week wrap: Sunday night runs into Monday morning', async () => {
      now = sgt('2026-11-09T01:00:00'); // Monday 01:00

      await expect(openNames()).resolves.toEqual([
        'Always Open',
        'Sunday Night',
      ]);
    });

    it('opens and closes on the exact minute', async () => {
      now = sgt('2026-11-04T09:00:00');
      await expect(openNames()).resolves.toContain('Weekday Cafe');
      now = sgt('2026-11-04T08:59:59');
      await expect(openNames()).resolves.not.toContain('Weekday Cafe');
      now = sgt('2026-11-04T18:00:00');
      await expect(openNames()).resolves.not.toContain('Weekday Cafe');
    });

    it('returns only the always-open supplier outside every interval', async () => {
      now = sgt('2026-11-07T12:00:00'); // Saturday noon

      await expect(openNames()).resolves.toEqual(['Always Open']);
    });

    it('counts and pages only the matching suppliers (N3.1.3)', async () => {
      const first = await queries.list(query({ openNow: true, limit: 1 }));
      const second = await queries.list(
        query({ openNow: true, limit: 1, offset: 1 }),
      );

      expect(first).toMatchObject({ total: 2, hasMore: true });
      expect(second).toMatchObject({ total: 2, hasMore: false });
      expect([...first.items, ...second.items].map((i) => i.name)).toEqual([
        'Always Open',
        'Weekday Cafe',
      ]);
    });

    it('combines with the other filters (F5.5)', async () => {
      await add('Weekday Cafe Two', weekdays, com3);

      await expect(openNames({ buildingId: [com3.id] })).resolves.toEqual([
        'Weekday Cafe Two',
      ]);
    });

    it('treats openNow=false as not set', async () => {
      const page = await queries.list(query({ openNow: false }));

      expect(page.total).toBe(6);
    });
  });

  it("never changes a supplier's status because of its hours (F2.7)", async () => {
    const { id } = await add('Weekday Cafe', weekdays);
    now = sgt('2026-11-07T12:00:00'); // closed on Saturday

    await expect(queries.get(id)).resolves.toMatchObject({
      isOpenNow: false,
      status: SupplierStatus.Active,
      version: 1,
    });
    const active = await queries.list(query({ status: SupplierStatus.Active }));
    expect(active.items.map((i) => i.name)).toEqual(['Weekday Cafe']);
  });
});
