import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
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
  SupplierOpeningInterval,
} from '../src/database/entities/index.js';
import { BuildingSeedService } from '../src/seed/building-seed.service.js';
import { SupplierSeedService } from '../src/seed/supplier-seed.service.js';
import { parseVenueSeed } from '../src/seed/venue-seed-file.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

const SEED_FILE = readFileSync('../data/csv/supplier-seed-data.csv');
// Every building in the seed JSON, whichever the suppliers sit in, plus the
// map-pin placeholder that every seeded database holds.
const SEED_BUILDING_COUNT =
  parseVenueSeed(readFileSync('../data/json/venues-seed.json')).buildings
    .length + 1;

const CONFIG: Record<string, unknown> = {
  SEED_ON_STARTUP: true,
  SEED_CSV_PATH: '../data/csv/supplier-seed-data.csv',
  VENUE_SEED_PATH: '../data/json/venues-seed.json',
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
};

describe('seed import (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let seed: SupplierSeedService;
  let buildings: BuildingsService;
  let categories: CategoriesService;
  let warn: ReturnType<typeof vi.spyOn>;

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

    const config = {
      get: (key: string) => CONFIG[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    categories = new CategoriesService(dataSource.getRepository(Category));
    seed = new SupplierSeedService(
      config,
      buildings,
      new BuildingSeedService(config, buildings),
      categories,
      new SuppliersService(dataSource, config),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals, suppliers, categories,
               venues, building_name_keys, buildings
    `);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function stored(name: string) {
    return dataSource.getRepository(Supplier).findOneOrFail({
      where: { name },
      relations: { building: true, categoryLinks: { category: true } },
    });
  }

  it('imports every row of the template seed file', async () => {
    await expect(seed.importSeed(SEED_FILE)).resolves.toEqual({
      created: 21,
      alreadyPresent: 0,
      rejected: 0,
    });

    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(await dataSource.getRepository(Building).count()).toBe(
      SEED_BUILDING_COUNT,
    );
    const categories = await dataSource.getRepository(Category).find();
    expect(categories.map((category) => category.name).sort()).toEqual([
      'Coffee',
      'Food',
      'Printing',
      'Shopping',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('records what it imports in the audit log, as the system (F14.4)', async () => {
    const [{ last }] = await dataSource.query<{ last: string }[]>(
      `SELECT coalesce(max(id), 0)::text AS last FROM audit_entries`,
    );

    await seed.importSeed(SEED_FILE);

    const added = await dataSource.query<
      { action: string; actor_id: string | null; n: number }[]
    >(
      `SELECT action, actor_id, count(*)::int AS n
       FROM audit_entries WHERE id > $1 GROUP BY action, actor_id`,
      [last],
    );
    // Every building of the seed file (62, with the map pin), 4 categories and 21 suppliers, none by a user.
    expect(Object.fromEntries(added.map((row) => [row.action, row.n]))).toEqual(
      {
        'building.created': 62,
        'category.created': 4,
        'supplier.created': 21,
      },
    );
    expect(added.every((row) => row.actor_id === null)).toBe(true);
  });

  it('is safe to run again: nothing duplicated, nothing failed (F12.1)', async () => {
    await seed.importSeed(SEED_FILE);

    await expect(seed.importSeed(SEED_FILE)).resolves.toEqual({
      created: 0,
      alreadyPresent: 21,
      rejected: 0,
    });
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(await dataSource.getRepository(Building).count()).toBe(
      SEED_BUILDING_COUNT,
    );
  });

  it('imports on startup only while there are no suppliers', async () => {
    await seed.onApplicationBootstrap();
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
  });

  it('does not bring back a renamed seed supplier on the next start', async () => {
    await seed.importSeed(SEED_FILE);
    const [first] = await dataSource.getRepository(Supplier).find();
    const originalName = first!.name;
    await dataSource
      .getRepository(Supplier)
      .update(first!.id, { name: 'Renamed Stall', nameKey: 'renamed stall' });

    await seed.onApplicationBootstrap();

    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(
      await dataSource.getRepository(Supplier).countBy({ name: originalName }),
    ).toBe(0);
  });

  it('is safe when two copies of the service seed at the same time', async () => {
    const reports = await Promise.all([
      seed.importSeed(SEED_FILE),
      seed.importSeed(SEED_FILE),
    ]);

    expect(reports[0].created + reports[1].created).toBe(21);
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(await dataSource.getRepository(Building).count()).toBe(
      SEED_BUILDING_COUNT,
    );
    expect(await dataSource.getRepository(Category).count()).toBe(4);
  });

  it('maps names, kinds, buildings and categories as configured', async () => {
    await seed.importSeed(SEED_FILE);

    // F12.2.6: the own-building suffix is stripped; F12.2.5: kind override.
    const printer = await stored('Printer');
    expect(printer).toMatchObject({ kind: 'Facility', floor: '1' });
    expect(printer.building?.shortName).toBe('COM2');
    expect((await stored('Central Square')).building?.shortName).toBe('YIH');

    // The Terrace outlets are renamed and belong to COM3.
    expect((await stored('InstaChef (Terrace)')).building?.shortName).toBe(
      'COM3',
    );
    expect((await stored('Smooy (Terrace)')).building?.shortName).toBe('COM3');

    // Windows-1252 row decoded and matched to PGP (F12.3, F12.2.1).
    expect((await stored('Octobox')).building?.shortName).toBe('PGP');

    // F12.2.2: "Food/Coffee" becomes two categories.
    const robot = await stored('Cafe+ Robot Cafe');
    expect(
      robot.categoryLinks?.map((link) => link.category?.name).sort(),
    ).toEqual(['Coffee', 'Food']);

    // F12.2.4: photo where present, otherwise none.
    expect((await stored('Cool Spot')).photoUrl).toMatch(/COOL_SPOT\.jpeg$/);
    expect((await stored('Nami')).photoUrl).toBeNull();
  });

  it("imports each row's times as opening hours on all seven days (F12.2.3)", async () => {
    await seed.importSeed(SEED_FILE);
    const intervalsOf = async (name: string) =>
      (
        await dataSource.getRepository(SupplierOpeningInterval).find({
          where: { supplierId: (await stored(name)).id },
          order: { day: 'ASC' },
        })
      ).map(({ day, opensAt, closesAt }) => ({ day, opensAt, closesAt }));

    // 0000hrs to 2359hrs: open around the clock, no intervals (F2.2).
    expect((await stored('Printer')).open24Hours).toBe(true);
    await expect(intervalsOf('Printer')).resolves.toEqual([]);

    // 0900hrs to 2130hrs: the same interval every day.
    expect((await stored('Cool Spot')).open24Hours).toBe(false);
    await expect(intervalsOf('Cool Spot')).resolves.toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        opensAt: 540,
        closesAt: 1290,
      })),
    );

    // 1100hrs to 0200hrs: overnight, kept as given (F2.3).
    await expect(intervalsOf('Supersnacks')).resolves.toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        opensAt: 660,
        closesAt: 120,
      })),
    );

    // Every one of the 21 suppliers has hours.
    const withHours = await dataSource.query<{ n: string }[]>(`
      SELECT count(*) AS n FROM suppliers s
      WHERE s.open_24_hours
         OR EXISTS (SELECT 1 FROM supplier_opening_intervals i WHERE i.supplier_id = s.id)
    `);
    expect(Number(withHours[0]!.n)).toBe(21);
  });

  it('strips a name suffix only when it names the row’s own building (F12.2.6)', async () => {
    const csv = [
      'Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL',
      'Stall @ Com2,Food,Com 2,1,By the lift,1.2940,103.7738,0900hrs,1800hrs,',
      'Kiosk @ COM3,Food,Com 2,1,By the stairs,1.2940,103.7738,0900hrs,1800hrs,',
      'Booth @ Nowhere,Food,Com 2,1,By the door,1.2940,103.7738,0900hrs,1800hrs,',
    ].join('\r\n');

    await expect(seed.importSeed(Buffer.from(csv))).resolves.toMatchObject({
      created: 3,
      rejected: 0,
    });

    // Own building (Com2 = COM2): suffix removed, display name re-adds it.
    expect((await stored('Stall')).building?.shortName).toBe('COM2');
    // Another real building, or no building at all: the name is kept whole.
    expect((await stored('Kiosk @ COM3')).building?.shortName).toBe('COM2');
    expect((await stored('Booth @ Nowhere')).building?.shortName).toBe('COM2');
  });

  it('does not re-create a building an admin retired (review #605)', async () => {
    await seed.importSeed(SEED_FILE);
    const frontier = await buildings.resolve('Frontier');
    await buildings.retire(frontier!.id);

    await expect(seed.importSeed(SEED_FILE)).resolves.toEqual({
      created: 0,
      alreadyPresent: 21,
      rejected: 0,
    });
    expect(await dataSource.getRepository(Building).count()).toBe(
      SEED_BUILDING_COUNT,
    );
    await expect(buildings.resolve('Frontier')).resolves.toBeNull();
  });

  it('does not re-create a category an admin retired (review #605)', async () => {
    await seed.importSeed(SEED_FILE);
    const printing = await categories.findActiveByName('Printing');
    await categories.retire(printing!.id);

    await expect(seed.importSeed(SEED_FILE)).resolves.toMatchObject({
      created: 0,
      alreadyPresent: 21,
    });
    expect(await dataSource.getRepository(Category).count()).toBe(4);
    await expect(categories.findActiveByName('Printing')).resolves.toBeNull();
  });

  it('creates no category for a row it rejects (review #605)', async () => {
    const csv = [
      'Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL',
      'Gadget Hub,Gadgets,COM3,Z,By the lift,1.2944,103.7726,0900hrs,1800hrs,',
    ].join('\r\n');

    await expect(seed.importSeed(Buffer.from(csv))).resolves.toMatchObject({
      created: 0,
      rejected: 1,
    });
    await expect(categories.findByName('Gadgets')).resolves.toBeNull();
  });

  it('skips bad rows, reports each with row, field and reason, and keeps going (F12.4)', async () => {
    const csv = [
      'Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL',
      'Good One,Food,COM3,1,By the lift,1.2944,103.7726,0900hrs,1800hrs,',
      'Lost,Food,Nowhere Hall,1,Somewhere,1.2944,103.7726,0900hrs,1800hrs,',
      'Bad Floor,Food,COM3,0,By the stairs,1.2944,103.9,0900hrs,1800hrs,',
      'Also Good,Shopping,Com 2,2,Opp LT16,1.2940,103.7738,0900hrs,1800hrs,',
      'Bad Time,Food,COM3,2,By the lift,1.2944,103.7726,noon,1800hrs,',
      'No Hours,Food,COM3,3,By the lift,1.2944,103.7726,,,',
    ].join('\r\n');

    await expect(seed.importSeed(Buffer.from(csv))).resolves.toEqual({
      created: 3,
      alreadyPresent: 0,
      rejected: 3,
    });

    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toEqual([
      'seed row 3 (Lost) rejected: Building: unknown building "Nowhere Hall"',
      expect.stringMatching(
        /^seed row 4 \(Bad Floor\) rejected: .*floor: .*coordinates\.longitude: /,
      ),
      'seed row 6 (Bad Time) rejected: StartingTime: "noon" is not a time like 0900hrs',
    ]);
    // A row without any times is imported, with no fixed hours (F1.2.8).
    const noHours = await stored('No Hours');
    expect(noHours.open24Hours).toBe(false);
    await expect(
      dataSource
        .getRepository(SupplierOpeningInterval)
        .countBy({ supplierId: noHours.id }),
    ).resolves.toBe(0);
  });
});
