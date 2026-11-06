import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  Supplier,
  SupplierKind,
  SupplierOpeningInterval,
  SupplierStatus,
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

/** The response body of a thrown HttpException. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (
    !(error instanceof BadRequestException) &&
    !(error instanceof ConflictException) &&
    !(error instanceof NotFoundException)
  ) {
    throw new Error(`expected an HTTP error, got ${String(error)}`);
  }
  return {
    status: error.getStatus(),
    body: error.getResponse() as Record<string, unknown>,
  };
}

describe('admin supplier writes (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let buildings: BuildingsService;
  let categories: CategoriesService;
  let brands: BrandsService;
  let com2: Building;
  let com3: Building;
  let food: Category;
  let coffee: Category;

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
    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    categories = new CategoriesService(dataSource.getRepository(Category));
    brands = new BrandsService(dataSource.getRepository(Brand));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals, suppliers, brands, categories,
               building_name_keys, buildings
    `);
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
      aliases: ['Terrace'],
      latitude: 1.2944,
      longitude: 103.7726,
    });
    food = await categories.create('Food');
    coffee = await categories.create('Coffee');
  });

  const coolSpot = () => ({
    name: 'Cool Spot',
    kind: SupplierKind.Store,
    categoryIds: [food.id],
    buildingId: com2.id,
    floor: '1',
    locationDescription: 'Opp LT16',
    coordinates: { latitude: 1.294, longitude: 103.7738 },
    photoUrl: 'https://example.com/cool-spot.jpg',
  });

  describe('create (F7.5)', () => {
    it('creates an Active supplier at version 1', async () => {
      const { id } = await suppliers.create(coolSpot());

      await expect(queries.get(id)).resolves.toMatchObject({
        displayName: 'Cool Spot @ COM2',
        status: 'Active',
        version: 1,
      });
    });

    it('reports field and reference problems in one 400 (F1.6.1)', async () => {
      const { status, body } = await failure(
        suppliers.create({
          ...coolSpot(),
          floor: 'Z',
          buildingId: '00000000-0000-4000-8000-000000000001',
        }),
      );

      expect(status).toBe(400);
      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(expect.arrayContaining(['floor', 'buildingId']));
      expect(await dataSource.getRepository(Supplier).count()).toBe(0);
    });
  });

  describe('update (F8.6, F14.3)', () => {
    it('changes only the supplied fields and bumps the version', async () => {
      const { id } = await suppliers.create(coolSpot());
      const before = await queries.get(id);

      await suppliers.update(id, 1, { name: 'Cool Spot Express', floor: '2' });

      const after = await queries.get(id);
      expect(after).toMatchObject({
        name: 'Cool Spot Express',
        displayName: 'Cool Spot Express @ COM2',
        floor: '2',
        locationDescription: 'Opp LT16',
        version: 2,
      });
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before.updatedAt.getTime(),
      );
      // The duplicate key follows the new name.
      await expect(
        dataSource.getRepository(Supplier).findOneByOrFail({ id }),
      ).resolves.toMatchObject({ nameKey: 'cool spot express' });
    });

    it('bumps the version even when only the categories change (F1.3.1)', async () => {
      const { id } = await suppliers.create(coolSpot());

      await suppliers.update(id, 1, { categoryIds: [coffee.id, food.id] });

      const after = await queries.get(id);
      expect(after.version).toBe(2);
      expect(after.categories.map((c) => c.name)).toEqual(['Coffee', 'Food']);
    });

    it('removes the photo when photoUrl is null', async () => {
      const { id } = await suppliers.create(coolSpot());

      await suppliers.update(id, 1, { photoUrl: null });

      await expect(queries.get(id)).resolves.toMatchObject({
        thumbnailUrl: null,
        images: null,
      });
    });

    it('refuses a stale version with the current one, changing nothing (F14.3.1)', async () => {
      const { id } = await suppliers.create(coolSpot());
      await suppliers.update(id, 1, { floor: '2' });

      const { status, body } = await failure(
        suppliers.update(id, 1, { floor: '3' }),
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({
        code: 'VERSION_CONFLICT',
        currentVersion: 2,
      });
      await expect(queries.get(id)).resolves.toMatchObject({
        floor: '2',
        version: 2,
      });
    });

    it('lets exactly one of two concurrent edits of the same version win', async () => {
      const { id } = await suppliers.create(coolSpot());

      const results = await Promise.allSettled([
        suppliers.update(id, 1, { floor: '2' }),
        suppliers.update(id, 1, { floor: '3' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(
        (
          (rejected as PromiseRejectedResult).reason as ConflictException
        ).getResponse(),
      ).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
      await expect(queries.get(id)).resolves.toMatchObject({ version: 2 });
    });

    it('refuses an edit that would duplicate another supplier (F1.5.1)', async () => {
      await suppliers.create(coolSpot());
      const { id } = await suppliers.create({ ...coolSpot(), floor: '2' });

      const { status, body } = await failure(
        suppliers.update(id, 1, { floor: '1' }),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_SUPPLIER');
      await expect(queries.get(id)).resolves.toMatchObject({
        floor: '2',
        version: 1,
      });
    });

    it('reports every field and reference problem at once', async () => {
      const { id } = await suppliers.create(coolSpot());

      const { status, body } = await failure(
        suppliers.update(id, 1, {
          name: '',
          version: 5,
          categoryIds: ['00000000-0000-4000-8000-000000000002'],
        }),
      );

      expect(status).toBe(400);
      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(expect.arrayContaining(['name', 'version', 'categoryIds']));
    });

    it('keeps a retired building the supplier already has, but refuses choosing one (F1.8)', async () => {
      const { id } = await suppliers.create(coolSpot());
      await buildings.retire(com2.id);

      // Editing another field, or sending the same retired building back, is fine.
      await suppliers.update(id, 1, { floor: '2' });
      await suppliers.update(id, 2, { buildingId: com2.id, floor: '3' });

      // Newly choosing a retired building is not.
      const other = await suppliers.create({
        ...coolSpot(),
        name: 'Other',
        buildingId: com3.id,
      });
      await buildings.retire(com3.id);
      const com4 = await buildings.create({
        canonicalName: 'Computing 4',
        shortName: 'COM4',
        aliases: [],
        latitude: 1.295,
        longitude: 103.774,
      });
      const { body } = await failure(
        suppliers.update(id, 3, { buildingId: com3.id }),
      );
      expect(body.violations).toEqual([
        {
          field: 'buildingId',
          reason: 'building is retired and cannot be chosen',
        },
      ]);
      await expect(
        suppliers.update(other.id, 1, { buildingId: com4.id }),
      ).resolves.toBeUndefined();
    });

    it('answers a distinct not-found for an unknown supplier', async () => {
      const { status, body } = await failure(
        suppliers.update('00000000-0000-4000-8000-000000000003', 1, {
          floor: '2',
        }),
      );
      expect(status).toBe(404);
      expect(body.code).toBe('SUPPLIER_NOT_FOUND');
    });
  });

  describe('opening hours (F1.2.8, F2)', () => {
    const weekdays = {
      days: {
        mon: [
          { opens: '13:00', closes: '18:00' },
          { opens: '09:00', closes: '12:00' },
        ],
        sat: [{ opens: '22:00', closes: '02:00' }],
      },
    };
    const intervalsOf = (id: string) =>
      dataSource
        .getRepository(SupplierOpeningInterval)
        .find({
          where: { supplierId: id },
          order: { day: 'ASC', opensAt: 'ASC' },
        })
        .then((rows) =>
          rows.map(({ day, opensAt, closesAt }) => ({
            day,
            opensAt,
            closesAt,
          })),
        );
    const flagOf = async (id: string) =>
      (await dataSource.getRepository(Supplier).findOneByOrFail({ id }))
        .open24Hours;

    it('stores weekly intervals when creating, overnight included (F2.1, F2.3)', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await expect(intervalsOf(id)).resolves.toEqual([
        { day: 0, opensAt: 540, closesAt: 720 },
        { day: 0, opensAt: 780, closesAt: 1080 },
        { day: 5, opensAt: 1320, closesAt: 120 },
      ]);
      await expect(flagOf(id)).resolves.toBe(false);
    });

    it('stores open around the clock as a flag without intervals (F2.2)', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: { open24Hours: true },
      });

      await expect(flagOf(id)).resolves.toBe(true);
      await expect(intervalsOf(id)).resolves.toEqual([]);
    });

    it('creates a supplier without hours as having none (F1.2.8)', async () => {
      const { id } = await suppliers.create(coolSpot());
      const none = await suppliers.create({
        ...coolSpot(),
        name: 'Other',
        openingHours: null,
      });

      for (const supplierId of [id, none.id]) {
        await expect(flagOf(supplierId)).resolves.toBe(false);
        await expect(intervalsOf(supplierId)).resolves.toEqual([]);
      }
    });

    it('refuses bad hours with their paths, saving no part of the supplier (F2.4, F1.6)', async () => {
      const { status, body } = await failure(
        suppliers.create({
          ...coolSpot(),
          openingHours: {
            days: {
              mon: [
                { opens: '09:00', closes: '12:00' },
                { opens: '11:00', closes: '18:00' },
              ],
              tue: [{ opens: '10:00', closes: '10:00' }],
            },
          },
        }),
      );

      expect(status).toBe(400);
      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(['openingHours.days.tue[0]', 'openingHours.days.mon[1]']);
      await expect(dataSource.getRepository(Supplier).count()).resolves.toBe(0);
      await expect(
        dataSource.getRepository(SupplierOpeningInterval).count(),
      ).resolves.toBe(0);
    });

    it('reports bad hours together with other field problems', async () => {
      const { body } = await failure(
        suppliers.create({
          ...coolSpot(),
          floor: 'Z',
          openingHours: { days: {} },
        }),
      );

      expect(
        new Set((body.violations as { field: string }[]).map((v) => v.field)),
      ).toEqual(new Set(['floor', 'openingHours.days']));
    });

    it('replaces the whole schedule on an edit and bumps the version, even if only the hours change (F1.3.1)', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await suppliers.update(id, 1, {
        openingHours: {
          days: { fri: [{ opens: '10:00', closes: '14:00' }] },
        },
      });

      await expect(intervalsOf(id)).resolves.toEqual([
        { day: 4, opensAt: 600, closesAt: 840 },
      ]);
      await expect(queries.get(id)).resolves.toMatchObject({
        version: 2,
        name: 'Cool Spot',
      });
    });

    it('switches between open around the clock and weekly hours', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await suppliers.update(id, 1, { openingHours: { open24Hours: true } });
      await expect(flagOf(id)).resolves.toBe(true);
      await expect(intervalsOf(id)).resolves.toEqual([]);

      await suppliers.update(id, 2, { openingHours: weekdays });
      await expect(flagOf(id)).resolves.toBe(false);
      await expect(intervalsOf(id)).resolves.toHaveLength(3);
    });

    it('removes the hours when openingHours is null', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await suppliers.update(id, 1, { openingHours: null });

      await expect(intervalsOf(id)).resolves.toEqual([]);
      await expect(flagOf(id)).resolves.toBe(false);
      await expect(queries.get(id)).resolves.toMatchObject({ version: 2 });
    });

    it('leaves the hours alone when an edit does not mention them', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await suppliers.update(id, 1, { locationDescription: 'Near the lift' });

      await expect(intervalsOf(id)).resolves.toHaveLength(3);
    });

    it('refuses overlapping hours on an edit, changing nothing (F2.4)', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      const { status } = await failure(
        suppliers.update(id, 1, {
          openingHours: {
            days: {
              sun: [{ opens: '23:00', closes: '03:00' }],
              mon: [{ opens: '02:00', closes: '09:00' }],
            },
          },
        }),
      );

      expect(status).toBe(400);
      await expect(intervalsOf(id)).resolves.toHaveLength(3);
      await expect(queries.get(id)).resolves.toMatchObject({ version: 1 });
    });

    it('deletes the intervals with their supplier', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        openingHours: weekdays,
      });

      await dataSource.query(`DELETE FROM suppliers WHERE id = $1`, [id]);

      await expect(intervalsOf(id)).resolves.toEqual([]);
    });

    it.each([
      ['a day outside 0-6', 7, 540, 720, 'CHK_supplier_opening_intervals_day'],
      [
        'a minute outside the day',
        0,
        1440,
        720,
        'CHK_supplier_opening_intervals_opens_at',
      ],
      [
        'equal opening and closing',
        0,
        540,
        540,
        'CHK_supplier_opening_intervals_differ',
      ],
    ])(
      'refuses %s in the database itself',
      async (_, day, opens, closes, check) => {
        const { id } = await suppliers.create(coolSpot());

        await expect(
          dataSource.query(
            `INSERT INTO supplier_opening_intervals (supplier_id, day, opens_at, closes_at)
           VALUES ($1, $2, $3, $4)`,
            [id, day, opens, closes],
          ),
        ).rejects.toMatchObject({ driverError: { constraint: check } });
      },
    );
  });

  describe('brand (F1.2.10, F3.4, F1.8)', () => {
    const brandOf = async (id: string) =>
      (await dataSource.getRepository(Supplier).findOneByOrFail({ id }))
        .brandId;

    it('creates a supplier with a brand, or without one (F1.2.10)', async () => {
      const cheers = await brands.create('Cheers');

      const withBrand = await suppliers.create({
        ...coolSpot(),
        brandId: cheers.id,
      });
      const without = await suppliers.create({
        ...coolSpot(),
        name: 'Plain Stall',
      });
      const explicitNull = await suppliers.create({
        ...coolSpot(),
        name: 'Null Stall',
        brandId: null,
      });

      await expect(brandOf(withBrand.id)).resolves.toBe(cheers.id);
      await expect(brandOf(without.id)).resolves.toBeNull();
      await expect(brandOf(explicitNull.id)).resolves.toBeNull();
    });

    it('lets several outlets share a brand, told apart by building and floor (F3.4, F1.5)', async () => {
      const cheers = await brands.create('Cheers');

      await suppliers.create({ ...coolSpot(), brandId: cheers.id });
      await expect(
        suppliers.create({
          ...coolSpot(),
          buildingId: com3.id,
          brandId: cheers.id,
        }),
      ).resolves.toBeDefined();
      // The same name, building and floor is still a duplicate, brand or not.
      const { status, body } = await failure(
        suppliers.create({ ...coolSpot(), brandId: cheers.id }),
      );
      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_SUPPLIER');
    });

    it('refuses a brand that does not exist, with its path, saving nothing', async () => {
      const { status, body } = await failure(
        suppliers.create({
          ...coolSpot(),
          brandId: '11111111-1111-4111-8111-111111111111',
        }),
      );

      expect(status).toBe(400);
      expect(body.violations).toEqual([
        { field: 'brandId', reason: 'brand does not exist' },
      ]);
      await expect(dataSource.getRepository(Supplier).count()).resolves.toBe(0);
    });

    it('refuses a malformed brand id', async () => {
      const { body } = await failure(
        suppliers.create({ ...coolSpot(), brandId: 'cheers' }),
      );

      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(['brandId']);
    });

    it('refuses a retired brand for a new supplier (F3.3.1)', async () => {
      const gone = await brands.create('Gone');
      await brands.retire(gone.id);

      const { body } = await failure(
        suppliers.create({ ...coolSpot(), brandId: gone.id }),
      );

      expect(body.violations).toEqual([
        { field: 'brandId', reason: 'brand is retired and cannot be chosen' },
      ]);
    });

    it('sets, changes and removes the brand on an edit, bumping the version', async () => {
      const cheers = await brands.create('Cheers');
      const coconut = await brands.create('Mr Coconut');
      const { id } = await suppliers.create(coolSpot());

      await suppliers.update(id, 1, { brandId: cheers.id });
      await expect(brandOf(id)).resolves.toBe(cheers.id);
      await expect(queries.get(id)).resolves.toMatchObject({ version: 2 });

      await suppliers.update(id, 2, { brandId: coconut.id });
      await expect(brandOf(id)).resolves.toBe(coconut.id);

      await suppliers.update(id, 3, { brandId: null });
      await expect(brandOf(id)).resolves.toBeNull();
      await expect(queries.get(id)).resolves.toMatchObject({ version: 4 });
    });

    it('leaves the brand alone when an edit does not mention it', async () => {
      const cheers = await brands.create('Cheers');
      const { id } = await suppliers.create({
        ...coolSpot(),
        brandId: cheers.id,
      });

      await suppliers.update(id, 1, { locationDescription: 'Near the lift' });

      await expect(brandOf(id)).resolves.toBe(cheers.id);
    });

    it('keeps a brand that was retired later, but refuses choosing another retired one (F1.8)', async () => {
      const cheers = await brands.create('Cheers');
      const other = await brands.create('Other');
      const { id } = await suppliers.create({
        ...coolSpot(),
        brandId: cheers.id,
      });
      await brands.retire(cheers.id);
      await brands.retire(other.id);

      // Editing something else, or sending the same retired brand, is fine.
      await suppliers.update(id, 1, { locationDescription: 'Near the lift' });
      await suppliers.update(id, 2, { brandId: cheers.id });
      await expect(brandOf(id)).resolves.toBe(cheers.id);

      const { body } = await failure(
        suppliers.update(id, 3, { brandId: other.id }),
      );
      expect(body.violations).toEqual([
        { field: 'brandId', reason: 'brand is retired and cannot be chosen' },
      ]);
      await expect(brandOf(id)).resolves.toBe(cheers.id);
    });

    it('refuses deleting a brand that suppliers hold, in the database itself', async () => {
      const cheers = await brands.create('Cheers');
      await suppliers.create({ ...coolSpot(), brandId: cheers.id });

      await expect(
        dataSource.query(`DELETE FROM brands WHERE id = $1`, [cheers.id]),
      ).rejects.toMatchObject({
        driverError: { constraint: 'FK_suppliers_brand' },
      });
    });
  });

  describe('status (F9.2, F9.5)', () => {
    it('deactivates and reactivates, bumping the version each time', async () => {
      const { id } = await suppliers.create(coolSpot());

      await suppliers.changeStatus(id, 1, SupplierStatus.Inactive);
      await expect(queries.get(id)).resolves.toMatchObject({
        status: 'Inactive',
        version: 2,
      });

      await suppliers.changeStatus(id, 2, SupplierStatus.Active);
      await expect(queries.get(id)).resolves.toMatchObject({
        status: 'Active',
        version: 3,
      });
    });

    it('refuses a change to the current status (F9.2)', async () => {
      const { id } = await suppliers.create(coolSpot());

      const { status, body } = await failure(
        suppliers.changeStatus(id, 1, SupplierStatus.Active),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('refuses a stale version (F14.3)', async () => {
      const { id } = await suppliers.create(coolSpot());
      await suppliers.update(id, 1, { floor: '2' });

      const { body } = await failure(
        suppliers.changeStatus(id, 1, SupplierStatus.Inactive),
      );
      expect(body).toMatchObject({
        code: 'VERSION_CONFLICT',
        currentVersion: 2,
      });
    });

    it('hides a deactivated supplier from the Active list but keeps it (D2 "delete")', async () => {
      const { id } = await suppliers.create(coolSpot());
      await suppliers.changeStatus(id, 1, SupplierStatus.Inactive);

      const active = await queries.list(
        Object.assign(new ListSuppliersQueryDto(), {
          status: SupplierStatus.Active,
        }),
      );
      expect(active.total).toBe(0);
      await expect(queries.get(id)).resolves.toMatchObject({
        status: 'Inactive',
      });
    });
  });
});
