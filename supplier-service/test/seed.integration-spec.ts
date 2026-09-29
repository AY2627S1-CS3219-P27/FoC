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
} from '../src/database/entities/index.js';
import { SupplierSeedService } from '../src/seed/supplier-seed.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';

const SEED_FILE = readFileSync('../data/csv/supplier-seed-data.csv');

const CONFIG: Record<string, unknown> = {
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
      categories,
      new SuppliersService(dataSource, config),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_categories, suppliers, categories,
               building_name_keys, buildings
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
    expect(await dataSource.getRepository(Building).count()).toBe(14);
    const categories = await dataSource.getRepository(Category).find();
    expect(categories.map((category) => category.name).sort()).toEqual([
      'Coffee',
      'Food',
      'Printing',
      'Shopping',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is safe to run again: nothing duplicated, nothing failed (F12.1)', async () => {
    await seed.importSeed(SEED_FILE);

    await expect(seed.importSeed(SEED_FILE)).resolves.toEqual({
      created: 0,
      alreadyPresent: 21,
      rejected: 0,
    });
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(await dataSource.getRepository(Building).count()).toBe(14);
  });

  it('is safe when two copies of the service seed at the same time', async () => {
    const reports = await Promise.all([
      seed.importSeed(SEED_FILE),
      seed.importSeed(SEED_FILE),
    ]);

    expect(reports[0].created + reports[1].created).toBe(21);
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
    expect(await dataSource.getRepository(Building).count()).toBe(14);
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
    expect(await dataSource.getRepository(Building).count()).toBe(14);
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
    ].join('\r\n');

    await expect(seed.importSeed(Buffer.from(csv))).resolves.toEqual({
      created: 2,
      alreadyPresent: 0,
      rejected: 2,
    });

    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toEqual([
      'seed row 3 (Lost) rejected: Building: unknown building "Nowhere Hall"',
      expect.stringMatching(
        /^seed row 4 \(Bad Floor\) rejected: .*floor: .*coordinates\.longitude: /,
      ),
    ]);
  });
});
