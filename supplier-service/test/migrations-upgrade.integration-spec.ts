import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { withActor } from '../src/audit/audit-context.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { databaseMigrations } from '../src/database/migrations/index.js';
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

const BUILDING = '6f1c2e0a-8d4b-4d3e-b1a2-9c8d7e6f5a41';
const CATEGORY = '0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11';
const SUPPLIER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REQUEST = '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a';
const BASIC_USER = '42424242-4242-4242-8242-424242424242';
const ADMIN = '01010101-0101-4101-8101-010101010101';

describe('upgrading a database that already holds data (real PostgreSQL)', () => {
  const environment = () => ({
    DB_HOST: process.env.DB_HOST!,
    DB_PORT: Number(process.env.DB_PORT),
    DB_USERNAME: process.env.DB_USERNAME!,
    DB_DATABASE: process.env.DB_DATABASE!,
    DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
    DB_MIGRATIONS_RUN: false,
  });
  // Everything before opening hours is what main already had.
  const firstNew = databaseMigrations.findIndex(
    (migration) => migration.name === 'AddOpeningHours1791072000000',
  );
  let upgraded: DataSource;

  beforeAll(async () => {
    expect(firstNew).toBeGreaterThan(0);

    // 1. The old schema, with a supplier, its category and a pending request,
    //    as an existing deployment would have them.
    const old = new DataSource({
      ...createDatabaseOptions(environment()),
      migrations: databaseMigrations.slice(0, firstNew),
    });
    await old.initialize();
    await old.dropDatabase();
    await old.runMigrations({ transaction: 'all' });
    await old.query(
      `INSERT INTO buildings (id, canonical_name, short_name, aliases, latitude, longitude)
       VALUES ($1, 'Computing 2', 'COM2', '{}', 1.2939, 103.7742)`,
      [BUILDING],
    );
    await old.query(
      `INSERT INTO building_name_keys (key, building_id) VALUES ('com2', $1)`,
      [BUILDING],
    );
    await old.query(
      `INSERT INTO categories (id, name, name_key) VALUES ($1, 'Food', 'food')`,
      [CATEGORY],
    );
    await old.query(
      `INSERT INTO suppliers (id, name, name_key, kind, building_id, floor,
                              location_description, latitude, longitude)
       VALUES ($1, 'Cool Spot', 'cool spot', 'Store', $2, '1', 'Opp LT16', 1.294, 103.7738)`,
      [SUPPLIER, BUILDING],
    );
    await old.query(
      `INSERT INTO supplier_categories (supplier_id, category_id) VALUES ($1, $2)`,
      [SUPPLIER, CATEGORY],
    );
    await old.query(
      `INSERT INTO supplier_requests (id, type, supplier_id, supplier_version, payload, submitted_by)
       VALUES ($1, 'Update', $2, 1, '{"floor": "2"}', $3)`,
      [REQUEST, SUPPLIER, BASIC_USER],
    );
    await old.destroy();

    // 2. The new migrations, applied on top of that data.
    upgraded = new DataSource(createDatabaseOptions(environment()));
    await upgraded.initialize();
    await upgraded.runMigrations({ transaction: 'all' });
  });

  afterAll(async () => {
    await upgraded?.destroy();
  });

  it('applies only the new migrations, and records them all', async () => {
    const rows = await upgraded.query<{ name: string }[]>(
      `SELECT name FROM supplier_service_migrations`,
    );

    expect(rows.map((row) => row.name).sort()).toEqual(
      databaseMigrations.map((migration) => migration.name).sort(),
    );
  });

  it('keeps the existing data exactly as it was, with the new columns empty', async () => {
    const [supplier] = await upgraded.query(
      `SELECT name, floor, version, status, open_24_hours, brand_id
       FROM suppliers WHERE id = $1`,
      [SUPPLIER],
    );

    expect(supplier).toMatchObject({
      name: 'Cool Spot',
      floor: '1',
      version: 1,
      status: 'Active',
      open_24_hours: false,
      brand_id: null,
    });
    await expect(
      upgraded.query(
        `SELECT count(*)::int AS n FROM supplier_opening_intervals`,
      ),
    ).resolves.toEqual([{ n: 0 }]);
    await expect(
      upgraded.query(`SELECT state FROM supplier_requests WHERE id = $1`, [
        REQUEST,
      ]),
    ).resolves.toEqual([{ state: 'Pending' }]);
  });

  it('creates the new tables, empty', async () => {
    for (const table of [
      'brands',
      'idempotency_keys',
      'audit_entries',
      'supplier_opening_intervals',
    ]) {
      const [row] = await upgraded.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      expect(row!.n).toBe(0);
    }
  });

  it('reads an old supplier as one with no hours and no brand', async () => {
    const queries = new SupplierQueriesService(upgraded, config);

    await expect(queries.get(SUPPLIER)).resolves.toMatchObject({
      name: 'Cool Spot',
      brand: null,
      openingHours: null,
      isOpenNow: null,
      nextChangeAt: null,
      version: 1,
    });
    const page = await queries.list(new ListSuppliersQueryDto());
    expect(page.items[0]).toMatchObject({ brand: null, isOpenNow: null });
  });

  it('lets a request filed before the upgrade be approved afterwards, and audits it', async () => {
    const suppliers = new SuppliersService(upgraded, config);
    const requests = new SupplierRequestsService(upgraded, suppliers);

    await withActor(ADMIN, () => requests.approve(REQUEST, ADMIN));

    const [supplier] = await upgraded.query(
      `SELECT floor, version FROM suppliers WHERE id = $1`,
      [SUPPLIER],
    );
    expect(supplier).toMatchObject({ floor: '2', version: 2 });
    const entries = await upgraded.query<
      { action: string; actor_id: string }[]
    >(`SELECT action, actor_id FROM audit_entries ORDER BY id`);
    expect(entries.map((entry) => entry.action)).toEqual([
      'supplier.updated',
      'request.approved',
    ]);
    expect(entries.every((entry) => entry.actor_id === ADMIN)).toBe(true);
  });

  it('has the append-only triggers on the upgraded audit table', async () => {
    await expect(upgraded.query(`DELETE FROM audit_entries`)).rejects.toThrow(
      /append-only/,
    );
  });
});
