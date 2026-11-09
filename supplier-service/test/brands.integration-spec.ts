import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BrandsService } from '../src/brands/brands.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { Brand } from '../src/database/entities/index.js';

/** The response body of a thrown HttpException. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ConflictException)) {
    throw new Error(`expected a conflict, got ${String(error)}`);
  }
  return {
    status: error.getStatus(),
    body: error.getResponse() as Record<string, unknown>,
  };
}

describe('brands (real PostgreSQL, F3)', () => {
  let dataSource: DataSource;
  let brands: BrandsService;

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
    brands = new BrandsService(dataSource.getRepository(Brand));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE supplier_requests, supplier_categories,
      supplier_opening_intervals, suppliers, brands`);
  });

  it('creates a brand with a system-generated id (F3.1)', async () => {
    const brand = await brands.create('Cheers');

    expect(brand).toMatchObject({ name: 'Cheers', retiredAt: null });
    expect(brand.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a name matching a non-retired brand, ignoring case and spaces (F3.2)', async () => {
    await brands.create('Mr Coconut');

    for (const clash of ['mr coconut', 'MR COCONUT', '  Mr   Coconut ']) {
      const { status, body } = await failure(brands.create(clash));
      expect(status).toBe(409);
      expect(body.code).toBe('DUPLICATE_NAME');
    }
  });

  it('refuses renaming to a name in use, but allows a same-name rename of itself (F3.2)', async () => {
    const cheers = await brands.create('Cheers');
    await brands.create('Mr Coconut');

    const { body } = await failure(brands.rename(cheers.id, 'mr coconut'));

    expect(body.code).toBe('DUPLICATE_NAME');
    await expect(brands.rename(cheers.id, 'CHEERS')).resolves.toMatchObject({
      name: 'CHEERS',
    });
  });

  it('lets only one of two simultaneous creates of one name win (F3.2)', async () => {
    const results = await Promise.allSettled([
      brands.create('Same Name'),
      brands.create('same name'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(dataSource.getRepository(Brand).count()).resolves.toBe(1);
  });

  it('lists only non-retired brands, by name (F3.5)', async () => {
    const zed = await brands.create('Zed');
    await brands.create('Alpha');
    const gone = await brands.create('Gone');
    await brands.retire(gone.id);

    expect((await brands.listActive()).map((b) => b.name)).toEqual([
      'Alpha',
      'Zed',
    ]);
    expect(zed.id).toBeDefined();
  });

  it("frees a retired brand's name for a new brand (F3.2)", async () => {
    const old = await brands.create('Cheers');
    await brands.retire(old.id);

    const fresh = await brands.create('Cheers');

    expect(fresh.id).not.toBe(old.id);
    expect((await brands.listActive()).map((b) => b.id)).toEqual([fresh.id]);
  });

  it('refuses to rename a retired brand, and retiring twice is harmless (F3.3.1)', async () => {
    const brand = await brands.create('Cheers');
    const retired = await brands.retire(brand.id);

    const { status } = await failure(brands.rename(brand.id, 'Other'));
    const again = await brands.retire(brand.id);

    expect(status).toBe(409);
    expect(again.retiredAt).toEqual(retired.retiredAt);
  });

  it('refuses a blank name in the database itself', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO brands (id, name, name_key) VALUES (gen_random_uuid(), '   ', 'x')`,
      ),
    ).rejects.toMatchObject({ driverError: { constraint: 'CHK_brands_name' } });
  });
});
