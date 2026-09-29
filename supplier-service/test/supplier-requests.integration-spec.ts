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
  RequestState,
  RequestType,
  Supplier,
  SupplierKind,
  SupplierRequest,
} from '../src/database/entities/index.js';
import { ListRequestsQueryDto } from '../src/requests/dto/list-requests-query.dto.js';
import { SupplierRequestsService } from '../src/requests/supplier-requests.service.js';
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

const BASIC_USER = '42';
const ADMIN = '1';
const OTHER_ADMIN = '2';

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

describe('supplier requests (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let requests: SupplierRequestsService;
  let buildings: BuildingsService;
  let categories: CategoriesService;
  let com2: Building;
  let food: Category;

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
    requests = new SupplierRequestsService(dataSource, suppliers);
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
    food = await categories.create('Food');
  });

  const coolSpot = () => ({
    name: 'Cool Spot',
    kind: SupplierKind.Store,
    categoryIds: [food.id],
    buildingId: com2.id,
    floor: '1',
    locationDescription: 'Opp LT16',
    coordinates: { latitude: 1.294, longitude: 103.7738 },
  });

  const listedSuppliers = async () =>
    (await queries.list(new ListSuppliersQueryDto())).total;

  const pending = () =>
    requests.listPending(Object.assign(new ListRequestsQueryDto(), {}));

  const stored = (id: string) =>
    dataSource.getRepository(SupplierRequest).findOneByOrFail({ id });

  describe('filing a creation (F7.1, F7.2)', () => {
    it('records a Pending request and creates no supplier yet', async () => {
      const request = await requests.submitCreation(coolSpot(), BASIC_USER);

      expect(request).toMatchObject({
        type: RequestType.Create,
        state: RequestState.Pending,
        submittedBy: BASIC_USER,
        resolvedBy: null,
        values: { name: 'Cool Spot', floor: '1', buildingId: com2.id },
      });
      expect(await listedSuppliers()).toBe(0);
      await expect(pending()).resolves.toMatchObject({ total: 1 });
    });

    it('validates like a direct create, all problems in one 400 (F1.6.1)', async () => {
      const { status, body } = await failure(
        requests.submitCreation(
          {
            ...coolSpot(),
            floor: 'Z',
            buildingId: '00000000-0000-4000-8000-000000000001',
          },
          BASIC_USER,
        ),
      );

      expect(status).toBe(400);
      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(expect.arrayContaining(['floor', 'buildingId']));
      expect(await dataSource.getRepository(SupplierRequest).count()).toBe(0);
    });

    it('refuses a supplier that already exists (F1.5)', async () => {
      await suppliers.create(coolSpot());

      const { status, body } = await failure(
        requests.submitCreation(
          { ...coolSpot(), name: ' cool  SPOT ' },
          BASIC_USER,
        ),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_SUPPLIER');
    });

    it('refuses a second identical pending request, however it is spelt', async () => {
      await requests.submitCreation(coolSpot(), BASIC_USER);

      const { status, body } = await failure(
        requests.submitCreation({ ...coolSpot(), name: 'COOL spot' }, '43'),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_REQUEST');
    });

    it('lets exactly one of two concurrent identical filings win', async () => {
      const results = await Promise.allSettled([
        requests.submitCreation(coolSpot(), BASIC_USER),
        requests.submitCreation(coolSpot(), '43'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(
        (
          (rejected as PromiseRejectedResult).reason as ConflictException
        ).getResponse(),
      ).toMatchObject({ code: 'DUPLICATE_REQUEST' });
    });

    it('accepts the same request again once the first is denied', async () => {
      const first = await requests.submitCreation(coolSpot(), BASIC_USER);
      await requests.deny(first.id, ADMIN, 'Not a real shop');

      await expect(
        requests.submitCreation(coolSpot(), BASIC_USER),
      ).resolves.toMatchObject({ state: RequestState.Pending });
    });
  });

  describe('listing (F6.7)', () => {
    it('lists only Pending requests, oldest first, with paging', async () => {
      const first = await requests.submitCreation(coolSpot(), BASIC_USER);
      const second = await requests.submitCreation(
        { ...coolSpot(), floor: '2' },
        BASIC_USER,
      );
      const third = await requests.submitCreation(
        { ...coolSpot(), floor: '3' },
        BASIC_USER,
      );
      await requests.deny(second.id, ADMIN, 'Duplicate');

      const page = await requests.listPending(
        Object.assign(new ListRequestsQueryDto(), { offset: 0, limit: 1 }),
      );

      expect(page).toMatchObject({
        total: 2,
        offset: 0,
        limit: 1,
        hasMore: true,
      });
      expect(page.items.map((r) => r.id)).toEqual([first.id]);
      const all = await pending();
      expect(all.items.map((r) => r.id)).toEqual([first.id, third.id]);
    });

    it('filters by type', async () => {
      await requests.submitCreation(coolSpot(), BASIC_USER);

      const updates = await requests.listPending(
        Object.assign(new ListRequestsQueryDto(), {
          type: RequestType.Update,
        }),
      );

      expect(updates.total).toBe(0);
    });
  });

  describe('approving (F6.3, F6.8, F7.3)', () => {
    it('creates the supplier and records who approved it and when', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      const approved = await requests.approve(filed.id, ADMIN);

      expect(approved).toMatchObject({
        state: RequestState.Approved,
        resolvedBy: ADMIN,
        submittedBy: BASIC_USER,
      });
      expect(approved.resolvedAt).toBeInstanceOf(Date);
      await expect(
        queries.get(approved.createdSupplierId!),
      ).resolves.toMatchObject({
        displayName: 'Cool Spot @ COM2',
        status: 'Active',
        version: 1,
      });
      expect(await listedSuppliers()).toBe(1);
      await expect(pending()).resolves.toMatchObject({ total: 0 });
    });

    it('re-checks duplicates at approval: an admin created it meanwhile (F7.3.1)', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);
      await suppliers.create(coolSpot());

      const { status, body } = await failure(requests.approve(filed.id, ADMIN));

      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_SUPPLIER');
      await expect(stored(filed.id)).resolves.toMatchObject({
        state: RequestState.Pending,
        resolvedBy: null,
      });
      expect(await listedSuppliers()).toBe(1);
    });

    it('changes nothing when the building was retired meanwhile (F6.8)', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);
      await buildings.retire(com2.id);

      const { status, body } = await failure(requests.approve(filed.id, ADMIN));

      expect(status).toBe(400);
      expect(body.violations).toEqual([
        {
          field: 'buildingId',
          reason: 'building is retired and cannot be chosen',
        },
      ]);
      await expect(stored(filed.id)).resolves.toMatchObject({
        state: RequestState.Pending,
      });
      expect(await dataSource.getRepository(Supplier).count()).toBe(0);
    });

    it('lets exactly one of two admins approving at once win', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      const results = await Promise.allSettled([
        requests.approve(filed.id, ADMIN),
        requests.approve(filed.id, OTHER_ADMIN),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(
        (
          (rejected as PromiseRejectedResult).reason as ConflictException
        ).getResponse(),
      ).toMatchObject({ code: 'REQUEST_ALREADY_RESOLVED' });
      expect(await dataSource.getRepository(Supplier).count()).toBe(1);
    });

    it('answers a distinct not-found for an unknown request', async () => {
      const { status, body } = await failure(
        requests.approve('00000000-0000-4000-8000-000000000009', ADMIN),
      );

      expect(status).toBe(404);
      expect(body.code).toBe('REQUEST_NOT_FOUND');
    });
  });

  describe('denying (F6.4)', () => {
    it('records the reason, who and when, and creates nothing', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      const denied = await requests.deny(filed.id, ADMIN, 'Closed down');

      expect(denied).toMatchObject({
        state: RequestState.Denied,
        resolvedBy: ADMIN,
        denialReason: 'Closed down',
        createdSupplierId: null,
      });
      expect(denied.resolvedAt).toBeInstanceOf(Date);
      expect(await dataSource.getRepository(Supplier).count()).toBe(0);
    });

    it('refuses acting again on a resolved request, either way (F6.3)', async () => {
      const denied = await requests.submitCreation(coolSpot(), BASIC_USER);
      await requests.deny(denied.id, ADMIN, 'No');
      const approved = await requests.submitCreation(
        { ...coolSpot(), floor: '2' },
        BASIC_USER,
      );
      await requests.approve(approved.id, ADMIN);

      for (const attempt of [
        () => requests.approve(denied.id, ADMIN),
        () => requests.deny(denied.id, ADMIN, 'Again'),
        () => requests.deny(approved.id, ADMIN, 'Changed my mind'),
        () => requests.approve(approved.id, ADMIN),
      ]) {
        const { status, body } = await failure(attempt());
        expect(status).toBe(409);
        expect(body.code).toBe('REQUEST_ALREADY_RESOLVED');
      }
      await expect(stored(denied.id)).resolves.toMatchObject({
        denialReason: 'No',
      });
      expect(await dataSource.getRepository(Supplier).count()).toBe(1);
    });
  });

  describe('filing an edit (F8.1-F8.3)', () => {
    it('records only the supplied fields and leaves the live supplier as it is (F8.2)', async () => {
      const { id } = await suppliers.create(coolSpot());

      const request = await requests.submitUpdate(
        id,
        1,
        { floor: 'b1', photoUrl: null },
        BASIC_USER,
      );

      expect(request).toMatchObject({
        type: RequestType.Update,
        state: RequestState.Pending,
        supplierId: id,
        supplierVersion: 1,
        submittedBy: BASIC_USER,
        values: { floor: 'B1', photoUrl: null },
      });
      expect(Object.keys(request.values).sort()).toEqual(['floor', 'photoUrl']);
      await expect(queries.get(id)).resolves.toMatchObject({
        floor: '1',
        version: 1,
      });
    });

    it('validates like an admin edit, all problems in one 400', async () => {
      const { id } = await suppliers.create(coolSpot());

      const { status, body } = await failure(
        requests.submitUpdate(
          id,
          1,
          {
            floor: 'Z',
            categoryIds: ['00000000-0000-4000-8000-000000000002'],
          },
          BASIC_USER,
        ),
      );

      expect(status).toBe(400);
      expect(
        (body.violations as { field: string }[]).map((v) => v.field),
      ).toEqual(expect.arrayContaining(['floor', 'categoryIds']));
      await expect(
        failure(requests.submitUpdate(id, 1, {}, BASIC_USER)),
      ).resolves.toMatchObject({ status: 400 });
      expect(await dataSource.getRepository(SupplierRequest).count()).toBe(0);
    });

    it('answers 404 for an unknown supplier and 409 for a stale version', async () => {
      const { id } = await suppliers.create(coolSpot());
      await suppliers.update(id, 1, { floor: '2' });

      await expect(
        failure(
          requests.submitUpdate(
            '00000000-0000-4000-8000-000000000003',
            1,
            { floor: '3' },
            BASIC_USER,
          ),
        ),
      ).resolves.toMatchObject({
        status: 404,
        body: { code: 'SUPPLIER_NOT_FOUND' },
      });
      await expect(
        failure(requests.submitUpdate(id, 1, { floor: '3' }, BASIC_USER)),
      ).resolves.toMatchObject({
        status: 409,
        body: { code: 'VERSION_CONFLICT', currentVersion: 2 },
      });
    });

    it('refuses an edit whose result would duplicate another supplier (F1.5.1)', async () => {
      await suppliers.create(coolSpot());
      const { id } = await suppliers.create({ ...coolSpot(), floor: '2' });

      await expect(
        failure(requests.submitUpdate(id, 1, { floor: '1' }, BASIC_USER)),
      ).resolves.toMatchObject({
        status: 409,
        body: { code: 'DUPLICATE_SUPPLIER' },
      });
      // Respelling its own name is not a duplicate of itself.
      await expect(
        requests.submitUpdate(id, 1, { name: 'COOL  spot' }, BASIC_USER),
      ).resolves.toMatchObject({ state: RequestState.Pending });
    });

    it('allows one pending edit per supplier, even when two are filed at once (F8.3)', async () => {
      const { id } = await suppliers.create(coolSpot());

      const results = await Promise.allSettled([
        requests.submitUpdate(id, 1, { floor: '2' }, BASIC_USER),
        requests.submitUpdate(id, 1, { floor: '3' }, '43'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(
        (
          (rejected as PromiseRejectedResult).reason as ConflictException
        ).getResponse(),
      ).toMatchObject({ code: 'DUPLICATE_REQUEST' });

      // Once it is resolved, a new edit may be filed.
      const [winner] = (await pending()).items;
      await requests.deny(winner.id, ADMIN, 'Wrong floor');
      await expect(
        requests.submitUpdate(id, 1, { floor: '4' }, BASIC_USER),
      ).resolves.toMatchObject({ state: RequestState.Pending });
    });
  });

  describe('approving an edit (F8.4, F8.4.1)', () => {
    it('applies the changes to the live supplier and bumps its version', async () => {
      const { id } = await suppliers.create({
        ...coolSpot(),
        photoUrl: 'https://example.com/cool-spot.jpg',
      });
      const filed = await requests.submitUpdate(
        id,
        1,
        { name: 'Cool Spot Express', photoUrl: null },
        BASIC_USER,
      );

      const approved = await requests.approve(filed.id, ADMIN);

      expect(approved).toMatchObject({
        state: RequestState.Approved,
        resolvedBy: ADMIN,
        createdSupplierId: null,
      });
      await expect(queries.get(id)).resolves.toMatchObject({
        name: 'Cool Spot Express',
        thumbnailUrl: null,
        floor: '1',
        version: 2,
      });
    });

    it('refuses the approval if the supplier changed since filing, changing nothing', async () => {
      const { id } = await suppliers.create(coolSpot());
      const filed = await requests.submitUpdate(
        id,
        1,
        { floor: '2' },
        BASIC_USER,
      );
      await suppliers.update(id, 1, { locationDescription: 'Near the lift' });

      const { status, body } = await failure(requests.approve(filed.id, ADMIN));

      expect(status).toBe(409);
      expect(body).toMatchObject({
        code: 'VERSION_CONFLICT',
        currentVersion: 2,
      });
      await expect(stored(filed.id)).resolves.toMatchObject({
        state: RequestState.Pending,
      });
      await expect(queries.get(id)).resolves.toMatchObject({
        floor: '1',
        locationDescription: 'Near the lift',
        version: 2,
      });
    });

    it('refuses the approval if the result now duplicates a newer supplier', async () => {
      const { id } = await suppliers.create(coolSpot());
      const filed = await requests.submitUpdate(
        id,
        1,
        { floor: '2' },
        BASIC_USER,
      );
      await suppliers.create({ ...coolSpot(), floor: '2' });

      const { status, body } = await failure(requests.approve(filed.id, ADMIN));

      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_SUPPLIER');
      await expect(stored(filed.id)).resolves.toMatchObject({
        state: RequestState.Pending,
      });
      await expect(queries.get(id)).resolves.toMatchObject({ version: 1 });
    });
  });

  describe('database rules (checked below the service)', () => {
    const insert = (values: string) =>
      dataSource.query(`
        INSERT INTO supplier_requests
          (id, type, state, supplier_id, supplier_version, payload,
           name_key, building_id, floor, submitted_by,
           resolved_by, resolved_at, denial_reason)
        VALUES ${values}
      `);

    it('refuses a creation without its duplicate key', async () => {
      await expect(
        insert(`(gen_random_uuid(), 'Create', 'Pending', NULL, NULL, '{}',
                 NULL, NULL, NULL, '42', NULL, NULL, NULL)`),
      ).rejects.toMatchObject({
        driverError: { constraint: 'CHK_supplier_requests_target' },
      });
    });

    it('refuses a resolved request with no resolver', async () => {
      await expect(
        insert(`(gen_random_uuid(), 'Create', 'Approved', NULL, NULL, '{}',
                 'x', '${com2.id}', '1', '42', NULL, NULL, NULL)`),
      ).rejects.toMatchObject({
        driverError: { constraint: 'CHK_supplier_requests_resolution' },
      });
    });

    it('refuses a denial without a reason, or with a blank one', async () => {
      for (const reason of ['NULL', `'   '`]) {
        await expect(
          insert(`(gen_random_uuid(), 'Create', 'Denied', NULL, NULL, '{}',
                   'x', '${com2.id}', '1', '42', '1', now(), ${reason})`),
        ).rejects.toMatchObject({
          driverError: { constraint: 'CHK_supplier_requests_denial_reason' },
        });
      }
    });
  });
});
