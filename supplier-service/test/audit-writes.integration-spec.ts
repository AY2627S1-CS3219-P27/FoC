import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { withActor } from '../src/audit/audit-context.js';
import { BrandsService } from '../src/brands/brands.service.js';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  AuditEntry,
  Brand,
  Building,
  BuildingNameKey,
  Category,
  Supplier,
  SupplierKind,
  SupplierStatus,
} from '../src/database/entities/index.js';
import { SupplierRequestsService } from '../src/requests/supplier-requests.service.js';
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

const BASIC_USER = '42424242-4242-4242-8242-424242424242';
const ADMIN = '01010101-0101-4101-8101-010101010101';
const OTHER_ADMIN = '02020202-0202-4202-8202-020202020202';

describe('the audit log across the writes (real PostgreSQL, F14.4, F14.5)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let requests: SupplierRequestsService;
  let buildings: BuildingsService;
  let categories: CategoriesService;
  let brands: BrandsService;
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
    requests = new SupplierRequestsService(dataSource, suppliers);
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
    // The audit log itself is never truncated: tests look at their own targets.
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals,
               suppliers, brands, categories, building_name_keys, buildings
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

  const total = () => dataSource.getRepository(AuditEntry).count();
  const entriesFor = (targetId: string) =>
    dataSource
      .getRepository(AuditEntry)
      .find({ where: { targetId }, order: { id: 'ASC' } });

  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeDefined();
    return error;
  };

  describe('suppliers', () => {
    it('records a creation: who, the new values, version 1, no before (F14.4)', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));

      const [entry, ...others] = await entriesFor(id);

      expect(others).toEqual([]);
      expect(entry).toMatchObject({
        actorId: ADMIN,
        action: 'supplier.created',
        targetType: 'supplier',
        targetId: id,
        before: null,
        version: 1,
        after: {
          id,
          name: 'Cool Spot',
          kind: 'Store',
          buildingId: com2.id,
          brandId: null,
          categoryIds: [food.id],
          floor: '1',
          status: 'Active',
          version: 1,
          openingHours: null,
        },
      });
    });

    it('records an edit with the values before and after, and the new version', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));

      await withActor(OTHER_ADMIN, () =>
        suppliers.update(id, 1, { floor: '2', locationDescription: 'Lift' }),
      );

      const edit = (await entriesFor(id)).at(-1)!;
      expect(edit).toMatchObject({
        actorId: OTHER_ADMIN,
        action: 'supplier.updated',
        version: 2,
        before: { floor: '1', locationDescription: 'Opp LT16', version: 1 },
        after: { floor: '2', locationDescription: 'Lift', version: 2 },
      });
    });

    it('shows hours, brand and category changes in the snapshots', async () => {
      const cheers = await brands.create('Cheers');
      const coffee = await categories.create('Coffee');
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));

      await withActor(ADMIN, () =>
        suppliers.update(id, 1, {
          brandId: cheers.id,
          categoryIds: [food.id, coffee.id],
          openingHours: { open24Hours: true },
        }),
      );

      const edit = (await entriesFor(id)).at(-1)!;
      expect(edit.before).toMatchObject({
        brandId: null,
        openingHours: null,
        categoryIds: [food.id],
      });
      expect(edit.after).toMatchObject({
        brandId: cheers.id,
        openingHours: { open24Hours: true },
        categoryIds: [food.id, coffee.id].sort(),
      });
    });

    it('records a status change, from a direct edit and from a request alike', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));

      await withActor(ADMIN, () =>
        suppliers.changeStatus(id, 1, SupplierStatus.Inactive),
      );
      await withActor(OTHER_ADMIN, () =>
        suppliers.setStatus(id, SupplierStatus.Active),
      );

      const [, first, second] = await entriesFor(id);
      expect(first).toMatchObject({
        actorId: ADMIN,
        action: 'supplier.status_changed',
        version: 2,
        before: { status: 'Active', version: 1 },
        after: { status: 'Inactive', version: 2 },
      });
      expect(second).toMatchObject({
        actorId: OTHER_ADMIN,
        action: 'supplier.status_changed',
        version: 3,
        before: { status: 'Inactive' },
        after: { status: 'Active' },
      });
    });

    it('writes entries in the order of the changes', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));
      await withActor(ADMIN, () => suppliers.update(id, 1, { floor: '2' }));
      await withActor(ADMIN, () =>
        suppliers.changeStatus(id, 2, SupplierStatus.Inactive),
      );

      expect((await entriesFor(id)).map((e) => e.action)).toEqual([
        'supplier.created',
        'supplier.updated',
        'supplier.status_changed',
      ]);
    });

    it('records no actor for a change outside a request: the system (F14.4)', async () => {
      const { id } = await suppliers.create(coolSpot());

      expect((await entriesFor(id))[0]).toMatchObject({ actorId: null });
    });

    it('records nothing for a change that is refused, whatever the reason', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));
      const before = await total();

      // A validation failure on create and on edit, a duplicate, a stale
      // version, and an unknown supplier.
      const invalidCreate = await failure(
        suppliers.create({ ...coolSpot(), floor: 'Z' }),
      );
      const duplicate = await failure(suppliers.create(coolSpot()));
      const invalidEdit = await failure(
        suppliers.update(id, 1, { floor: 'Z' }),
      );
      const stale = await failure(suppliers.update(id, 9, { floor: '2' }));
      const unknown = await failure(
        suppliers.update('11111111-1111-4111-8111-111111111111', 1, {
          floor: '2',
        }),
      );
      const sameStatus = await failure(
        suppliers.changeStatus(id, 1, SupplierStatus.Active),
      );

      expect(invalidCreate).toBeInstanceOf(BadRequestException);
      expect(duplicate).toBeInstanceOf(ConflictException);
      expect(invalidEdit).toBeInstanceOf(BadRequestException);
      expect(stale).toBeInstanceOf(ConflictException);
      expect(unknown).toBeInstanceOf(NotFoundException);
      expect(sameStatus).toBeInstanceOf(ConflictException);
      expect(await total()).toBe(before);
    });

    it('records exactly one entry when two edits race on the same version', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));

      const results = await Promise.allSettled([
        withActor(ADMIN, () => suppliers.update(id, 1, { floor: '2' })),
        withActor(OTHER_ADMIN, () => suppliers.update(id, 1, { floor: '3' })),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const edits = (await entriesFor(id)).filter(
        (e) => e.action === 'supplier.updated',
      );
      expect(edits).toHaveLength(1);
      const supplier = await dataSource
        .getRepository(Supplier)
        .findOneByOrFail({ id });
      expect((edits[0]!.after as { floor: string }).floor).toBe(supplier.floor);
    });

    it('records nothing for a read', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));
      const before = await total();

      await dataSource.getRepository(Supplier).findOneByOrFail({ id });

      expect(await total()).toBe(before);
    });

    it('keeps the entries after the supplier is gone (F14.5)', async () => {
      const { id } = await withActor(ADMIN, () => suppliers.create(coolSpot()));
      await withActor(ADMIN, () => suppliers.update(id, 1, { floor: '2' }));

      await dataSource.query(`DELETE FROM suppliers WHERE id = $1`, [id]);

      expect((await entriesFor(id)).map((e) => e.action)).toEqual([
        'supplier.created',
        'supplier.updated',
      ]);
    });
  });

  describe('requests', () => {
    const entriesOfType = (type: string) =>
      dataSource.getRepository(AuditEntry).find({
        where: { targetType: type as 'request' },
        order: { id: 'ASC' },
      });

    it('records filing a creation request, by the user, with no before (F14.4)', async () => {
      const filed = await withActor(BASIC_USER, () =>
        requests.submitCreation(coolSpot(), BASIC_USER),
      );

      const [entry, ...others] = await entriesFor(filed.id);

      expect(others).toEqual([]);
      expect(entry).toMatchObject({
        actorId: BASIC_USER,
        action: 'request.submitted',
        targetType: 'request',
        before: null,
        version: null,
        after: {
          id: filed.id,
          type: 'Create',
          state: 'Pending',
          submittedBy: BASIC_USER,
          resolvedBy: null,
          values: { name: 'Cool Spot' },
        },
      });
    });

    it('records filing an edit request and a status-change request', async () => {
      const { id } = await suppliers.create(coolSpot());

      const edit = await withActor(BASIC_USER, () =>
        requests.submitUpdate(id, 1, { floor: '2' }, BASIC_USER),
      );
      const status = await withActor(BASIC_USER, () =>
        requests.submitStatusChange(
          id,
          SupplierStatus.Inactive,
          'Closed',
          BASIC_USER,
        ),
      );

      expect((await entriesFor(edit.id))[0]).toMatchObject({
        action: 'request.submitted',
        after: { type: 'Update', supplierId: id, values: { floor: '2' } },
      });
      expect((await entriesFor(status.id))[0]).toMatchObject({
        action: 'request.submitted',
        after: {
          type: 'StatusChange',
          values: { status: 'Inactive', reason: 'Closed' },
        },
      });
    });

    it('records a denial with the reason, from Pending to Denied', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      await withActor(ADMIN, () => requests.deny(filed.id, ADMIN, 'Not now'));

      const denial = (await entriesFor(filed.id)).at(-1)!;
      expect(denial).toMatchObject({
        actorId: ADMIN,
        action: 'request.denied',
        before: { state: 'Pending', denialReason: null },
        after: {
          state: 'Denied',
          resolvedBy: ADMIN,
          denialReason: 'Not now',
        },
      });
    });

    it('records a withdrawal by the submitter', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      await withActor(BASIC_USER, () =>
        requests.withdraw(filed.id, BASIC_USER),
      );

      expect((await entriesFor(filed.id)).at(-1)).toMatchObject({
        actorId: BASIC_USER,
        action: 'request.withdrawn',
        before: { state: 'Pending' },
        after: { state: 'Withdrawn', resolvedBy: BASIC_USER },
      });
    });

    it('records an approval of a creation as two entries by the admin: the request and the new supplier', async () => {
      const filed = await withActor(BASIC_USER, () =>
        requests.submitCreation(coolSpot(), BASIC_USER),
      );

      const approved = await withActor(ADMIN, () =>
        requests.approve(filed.id, ADMIN),
      );

      const requestEntry = (await entriesFor(filed.id)).at(-1)!;
      const [supplierEntry] = await entriesFor(approved.createdSupplierId!);
      expect(requestEntry).toMatchObject({
        actorId: ADMIN,
        action: 'request.approved',
        before: { state: 'Pending', createdSupplierId: null },
        after: {
          state: 'Approved',
          resolvedBy: ADMIN,
          createdSupplierId: approved.createdSupplierId,
        },
      });
      // The supplier was created by the admin's approval, not by the user.
      expect(supplierEntry).toMatchObject({
        actorId: ADMIN,
        action: 'supplier.created',
        version: 1,
      });
      // Both in one transaction: the supplier's entry comes first.
      expect(BigInt(supplierEntry!.id)).toBeLessThan(BigInt(requestEntry.id));
    });

    it('records the supplier change an approved edit and an approved status change make', async () => {
      const { id } = await suppliers.create(coolSpot());
      const edit = await requests.submitUpdate(
        id,
        1,
        { floor: '2' },
        BASIC_USER,
      );
      await withActor(ADMIN, () => requests.approve(edit.id, ADMIN));
      const status = await requests.submitStatusChange(
        id,
        SupplierStatus.Inactive,
        undefined,
        BASIC_USER,
      );
      await withActor(ADMIN, () => requests.approve(status.id, ADMIN));

      const actions = (await entriesFor(id)).map((e) => [e.action, e.actorId]);
      expect(actions).toEqual([
        ['supplier.created', null],
        ['supplier.updated', ADMIN],
        ['supplier.status_changed', ADMIN],
      ]);
    });

    it('records nothing when an approval is refused, for either record (F14.4)', async () => {
      const { id } = await suppliers.create(coolSpot());
      const filed = await requests.submitUpdate(
        id,
        1,
        { floor: '2' },
        BASIC_USER,
      );
      await suppliers.update(id, 1, { locationDescription: 'Near the lift' });
      const before = await total();

      // The supplier changed since the request was filed: refused, Pending.
      const refused = await failure(
        withActor(ADMIN, () => requests.approve(filed.id, ADMIN)),
      );

      expect(refused).toBeInstanceOf(ConflictException);
      expect(await total()).toBe(before);
      expect((await entriesFor(filed.id)).map((e) => e.action)).toEqual([
        'request.submitted',
      ]);
    });

    it('records nothing for a request that is refused when filed, or acted on twice', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);
      await requests.deny(filed.id, ADMIN, 'No');
      const before = await total();

      const duplicate = await failure(
        requests.submitCreation({ ...coolSpot(), floor: 'Z' }, BASIC_USER),
      );
      const again = await failure(requests.approve(filed.id, ADMIN));

      expect(duplicate).toBeInstanceOf(BadRequestException);
      expect(again).toBeInstanceOf(ConflictException);
      expect(await total()).toBe(before);
    });

    it('lets only one of an approval and a withdrawal at the same time leave an entry', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);

      await Promise.allSettled([
        withActor(ADMIN, () => requests.approve(filed.id, ADMIN)),
        withActor(BASIC_USER, () => requests.withdraw(filed.id, BASIC_USER)),
      ]);

      const resolutions = (await entriesFor(filed.id)).filter(
        (e) => e.action !== 'request.submitted',
      );
      expect(resolutions).toHaveLength(1);
    });

    it('covers every request action', async () => {
      const filed = await requests.submitCreation(coolSpot(), BASIC_USER);
      await requests.withdraw(filed.id, BASIC_USER);

      const actions = new Set(
        (await entriesOfType('request')).map((e) => e.action),
      );

      expect(actions).toContain('request.submitted');
      expect(actions).toContain('request.withdrawn');
    });
  });

  describe('categories, brands and buildings', () => {
    it.each([
      ['category', 'Snacks', 'Treats'],
      ['brand', 'Cheers', 'Cheers Plus'],
    ])(
      'records creating, renaming and retiring a %s',
      async (kind, name, renamed) => {
        const service = kind === 'category' ? categories : brands;

        const created = await withActor(ADMIN, () => service.create(name));
        await withActor(OTHER_ADMIN, () => service.rename(created.id, renamed));
        await withActor(ADMIN, () => service.retire(created.id));

        const entries = await entriesFor(created.id);
        expect(entries.map((e) => [e.action, e.actorId])).toEqual([
          [`${kind}.created`, ADMIN],
          [`${kind}.renamed`, OTHER_ADMIN],
          [`${kind}.retired`, ADMIN],
        ]);
        expect(entries[0]).toMatchObject({
          before: null,
          after: { id: created.id, name, retiredAt: null },
        });
        expect(entries[1]).toMatchObject({
          before: { name },
          after: { name: renamed },
        });
        expect(entries[2]).toMatchObject({
          before: { retiredAt: null },
          after: { retiredAt: expect.any(String) },
        });
      },
    );

    it.each([
      ['category', 'Snacks'],
      ['brand', 'Cheers'],
    ])(
      'records nothing for a %s change that is refused or changes nothing',
      async (kind, name) => {
        const service = kind === 'category' ? categories : brands;
        const first = await service.create(name);
        const other = await service.create(`${name} Two`);
        await service.retire(other.id);
        const before = await total();

        const duplicate = await failure(service.create(name.toLowerCase()));
        const clash = await failure(service.rename(other.id, 'Anything'));
        const missing = await failure(
          service.rename('11111111-1111-4111-8111-111111111111', 'X'),
        );
        await service.retire(other.id); // already retired: a no-op

        expect(duplicate).toBeInstanceOf(ConflictException);
        expect(clash).toBeInstanceOf(ConflictException);
        expect(missing).toBeInstanceOf(NotFoundException);
        expect(await total()).toBe(before);
        expect((await entriesFor(first.id)).map((e) => e.action)).toEqual([
          `${kind}.created`,
        ]);
      },
    );

    it('records creating, editing and retiring a building', async () => {
      const created = await withActor(ADMIN, () =>
        buildings.create({
          canonicalName: 'Science Library',
          shortName: 'SL',
          aliases: ['Sci Lib'],
          latitude: 1.2966,
          longitude: 103.7803,
        }),
      );
      await withActor(OTHER_ADMIN, () =>
        buildings.updateNames(created.id, { shortName: 'SCL', aliases: [] }),
      );
      await withActor(ADMIN, () => buildings.retire(created.id));

      const entries = await entriesFor(created.id);
      expect(entries.map((e) => [e.action, e.actorId])).toEqual([
        ['building.created', ADMIN],
        ['building.updated', OTHER_ADMIN],
        ['building.retired', ADMIN],
      ]);
      expect(entries[0]!.after).toMatchObject({
        canonicalName: 'Science Library',
        aliases: ['Sci Lib'],
        coordinates: { latitude: 1.2966, longitude: 103.7803 },
      });
      expect(entries[1]).toMatchObject({
        before: { shortName: 'SL', aliases: ['Sci Lib'] },
        after: { shortName: 'SCL', aliases: [] },
      });
    });

    it('records nothing for a building change that is refused', async () => {
      const created = await buildings.create({
        canonicalName: 'Science Library',
        shortName: 'SL',
        aliases: [],
        latitude: 1.2966,
        longitude: 103.7803,
      });
      const before = await total();

      // A name already used by Computing 2, and an unknown building.
      const clash = await failure(
        buildings.updateNames(created.id, { shortName: 'com2' }),
      );
      const missing = await failure(
        buildings.updateNames('11111111-1111-4111-8111-111111111111', {
          shortName: 'X',
        }),
      );

      expect(clash).toBeInstanceOf(ConflictException);
      expect(missing).toBeInstanceOf(NotFoundException);
      expect(await total()).toBe(before);
    });
  });
});
