import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, suppliers, categories,
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
