import 'reflect-metadata';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException, Logger } from '@nestjs/common';
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
  Venue,
} from '../src/database/entities/index.js';
import { BuildingSeedService } from '../src/seed/building-seed.service.js';
import { SupplierSeedService } from '../src/seed/supplier-seed.service.js';
import { SeedFileUnreadableError } from '../src/seed/venue-seed-file.js';
import { VenueSeedService } from '../src/seed/venue-seed.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import { VenuesService } from '../src/venues/venues.service.js';

const SEED_PATH = '../data/json/venues-seed.json';
const SEED = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
  buildings: { shortName: string; canonicalName: string; aliases: string[] }[];
  venues: { buildingShortName: string; code: string }[];
};
/** Every seeded database also holds the map-pin placeholder, which is not in the file. */
const BUILDING_COUNT = SEED.buildings.length + 1;

describe('venue seed (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let config: Record<string, unknown>;
  let buildings: BuildingsService;
  let venues: VenuesService;
  let buildingSeed: BuildingSeedService;
  let venueSeed: VenueSeedService;
  let supplierSeed: SupplierSeedService;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

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
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE supplier_requests, supplier_categories, supplier_opening_intervals, suppliers, brands, categories,
               venues, building_name_keys, buildings
    `);
    config = {
      SEED_ON_STARTUP: false,
      SEED_CSV_PATH: '../data/csv/supplier-seed-data.csv',
      VENUE_SEED_PATH: SEED_PATH,
      CAMPUS_MIN_LATITUDE: 1.28,
      CAMPUS_MAX_LATITUDE: 1.31,
      CAMPUS_MIN_LONGITUDE: 103.74,
      CAMPUS_MAX_LONGITUDE: 103.79,
    };
    const configService = {
      get: (key: string) => config[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;

    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    venues = new VenuesService(dataSource.getRepository(Venue));
    buildingSeed = new BuildingSeedService(configService, buildings);
    venueSeed = new VenueSeedService(
      configService,
      buildingSeed,
      buildings,
      venues,
    );
    supplierSeed = new SupplierSeedService(
      configService,
      buildings,
      buildingSeed,
      new CategoriesService(dataSource.getRepository(Category)),
      new SuppliersService(dataSource, configService),
    );

    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Writes a seed file of this shape to a throwaway path. */
  function seedFile(contents: string | object): string {
    const path = join(mkdtempSync(join(tmpdir(), 'venue-seed-')), 'seed.json');
    writeFileSync(
      path,
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );
    return path;
  }

  const miniSeed = (venueExtra: object = {}) => ({
    buildings: [
      {
        shortName: 'COM1',
        canonicalName: 'Computing 1',
        aliases: [],
        latitude: 1.2948,
        longitude: 103.774,
      },
    ],
    venues: [
      {
        buildingShortName: 'COM1',
        code: 'COM1-0201',
        name: 'Seminar Room',
        floor: '2',
        latitude: 1.2949,
        longitude: 103.7741,
        needsReview: false,
        ...venueExtra,
      },
    ],
  });

  describe('the map-pin building', () => {
    const pinRows = () =>
      dataSource.getRepository(Building).findBy({ shortName: 'PIN' });

    it('exists after startup even with no venue path and the supplier seed off', async () => {
      delete config.VENUE_SEED_PATH;
      expect(config.SEED_ON_STARTUP).toBe(false);

      await buildingSeed.onApplicationBootstrap();

      const all = await dataSource.getRepository(Building).find();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        canonicalName: 'Other (map pin)',
        shortName: 'PIN',
        aliases: [],
        retiredAt: null,
      });
      expect(all[0]!.latitude).toBeGreaterThan(1.28);
      expect(all[0]!.latitude).toBeLessThan(1.31);
      expect(all[0]!.longitude).toBeGreaterThan(103.74);
      expect(all[0]!.longitude).toBeLessThan(103.79);
      // Created through the normal path, so both names resolve to it.
      expect((await buildings.resolve('pin'))?.id).toBe(all[0]!.id);
      expect((await buildings.resolve('Other (map pin)'))?.id).toBe(all[0]!.id);
    });

    it.each([
      ['without', false],
      ['with', true],
    ])(
      'is untouched by a second startup %s the venue path',
      async (_, withPath) => {
        if (!withPath) {
          delete config.VENUE_SEED_PATH;
        }
        await buildingSeed.onApplicationBootstrap();
        const before = await dataSource.query(
          'SELECT id, updated_at FROM buildings',
        );

        await buildingSeed.onApplicationBootstrap();
        await venueSeed.onApplicationBootstrap();

        expect(
          await dataSource.query(
            "SELECT id, updated_at FROM buildings WHERE short_name = 'PIN'",
          ),
        ).toEqual(before);
        expect(await pinRows()).toHaveLength(1);
      },
    );

    it('is the only pin building once the whole seed has loaded', async () => {
      await venueSeed.load();
      await supplierSeed.importSeed(
        readFileSync('../data/csv/supplier-seed-data.csv'),
      );

      expect(await dataSource.getRepository(Building).count()).toBe(
        BUILDING_COUNT,
      );
      expect(await pinRows()).toHaveLength(1);
    });

    it('is not created, and the conflict is logged, when another building has its canonical name', async () => {
      const existing = await buildings.create({
        canonicalName: 'Other (map pin)',
        shortName: 'OTH',
        aliases: [],
        latitude: 1.3,
        longitude: 103.78,
      });

      await buildingSeed.onApplicationBootstrap();

      const all = await dataSource.getRepository(Building).find();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(existing.id);
      expect(await pinRows()).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('seed building Other (map pin) not created'),
      );
    });

    it('leaves a building that already has the PIN short name alone, and treats it as the pin', async () => {
      const existing = await buildings.create({
        canonicalName: 'Parking Inn',
        shortName: 'PIN',
        aliases: [],
        latitude: 1.3,
        longitude: 103.78,
      });

      await buildingSeed.onApplicationBootstrap();

      const all = await dataSource.getRepository(Building).find();
      expect(all.map((b) => b.id)).toEqual([existing.id]);
      await expect(buildings.retire(existing.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('can be renamed but keeps its short name', async () => {
      await buildingSeed.onApplicationBootstrap();
      const [pin] = await pinRows();

      await expect(
        buildings.updateNames(pin!.id, { shortName: 'OTH' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        buildings.updateNames(pin!.id, { shortName: 'PIN' }),
      ).resolves.toMatchObject({ shortName: 'PIN' });
      await expect(
        buildings.updateNames(pin!.id, { canonicalName: 'Drop a pin' }),
      ).resolves.toMatchObject({ canonicalName: 'Drop a pin' });
      expect(await pinRows()).toHaveLength(1);
    });

    it('cannot be retired', async () => {
      await buildingSeed.onApplicationBootstrap();
      const [pin] = await pinRows();

      await expect(buildings.retire(pin!.id)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect((await buildings.findById(pin!.id))?.retiredAt).toBeNull();
    });

    it('takes no venue', async () => {
      await buildingSeed.onApplicationBootstrap();
      const [pin] = await pinRows();

      await expect(
        venues.create({
          buildingId: pin!.id,
          code: 'PIN-01',
          name: null,
          floor: '1',
          latitude: 1.295,
          longitude: 103.765,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await dataSource.getRepository(Venue).count()).toBe(0);
    });

    it('is skipped, and logged, if the seed file lists venues for it', async () => {
      const seed = miniSeed({ buildingShortName: 'PIN' });
      seed.buildings.push({
        shortName: 'PIN',
        canonicalName: 'Pin',
        aliases: [],
        latitude: 1.295,
        longitude: 103.765,
      });
      config.VENUE_SEED_PATH = seedFile(seed);

      await expect(venueSeed.load()).resolves.toEqual({
        created: 0,
        alreadyPresent: 0,
        skipped: 1,
      });

      expect(await dataSource.getRepository(Venue).count()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        'seed venues for PIN skipped: building is the map-pin placeholder',
      );
    });
  });

  it('loads every building and venue in the file', async () => {
    await expect(venueSeed.load()).resolves.toEqual({
      created: SEED.venues.length,
      alreadyPresent: 0,
      skipped: 0,
    });

    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
    expect(await dataSource.getRepository(Venue).count()).toBe(
      SEED.venues.length,
    );

    const com1 = (await buildings.resolve('COM1'))!;
    const expected = SEED.venues.filter(
      (venue) => venue.buildingShortName === 'COM1',
    ).length;
    expect(await venues.listActive(com1.id)).toHaveLength(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('changes nothing when run again', async () => {
    await venueSeed.load();
    const before = await dataSource.query(
      'SELECT id, updated_at FROM venues ORDER BY id',
    );

    await expect(venueSeed.load()).resolves.toEqual({
      created: 0,
      alreadyPresent: SEED.venues.length,
      skipped: 0,
    });

    expect(
      await dataSource.query('SELECT id, updated_at FROM venues ORDER BY id'),
    ).toEqual(before);
    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
  });

  it('does not recreate a renamed building on the next startup', async () => {
    await venueSeed.onApplicationBootstrap();
    const building = (await dataSource.getRepository(Building).find()).find(
      (b) => b.shortName !== 'PIN',
    )!;
    await buildings.updateNames(building.id, {
      canonicalName: 'Renamed',
      shortName: 'RN',
      aliases: [],
    });
    const before = await dataSource.getRepository(Building).count();

    await venueSeed.onApplicationBootstrap();

    expect(await dataSource.getRepository(Building).count()).toBe(before);
  });

  it('loads on startup whenever the path is set, even with the supplier seed off', async () => {
    expect(config.SEED_ON_STARTUP).toBe(false);

    await venueSeed.onApplicationBootstrap();

    expect(await dataSource.getRepository(Venue).count()).toBe(
      SEED.venues.length,
    );
  });

  it('does nothing on startup when the path is not set', async () => {
    delete config.VENUE_SEED_PATH;

    await venueSeed.onApplicationBootstrap();

    expect(await dataSource.getRepository(Venue).count()).toBe(0);
    expect(await dataSource.getRepository(Building).count()).toBe(0);
  });

  it('loads into a database that already has suppliers', async () => {
    await supplierSeed.importSeed(
      readFileSync('../data/csv/supplier-seed-data.csv'),
    );
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);

    await venueSeed.load();

    expect(await dataSource.getRepository(Venue).count()).toBe(
      SEED.venues.length,
    );
    expect(await dataSource.getRepository(Supplier).count()).toBe(21);
  });

  it('gives the supplier import the same buildings, with or without the venue load', async () => {
    await supplierSeed.importSeed(
      readFileSync('../data/csv/supplier-seed-data.csv'),
    );
    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );

    await venueSeed.load();

    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
  });

  it('skips and logs rows flagged for review', async () => {
    config.VENUE_SEED_PATH = seedFile(miniSeed({ needsReview: true }));

    await expect(venueSeed.load()).resolves.toEqual({
      created: 0,
      alreadyPresent: 0,
      skipped: 1,
    });

    expect(await dataSource.getRepository(Venue).count()).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      'seed venue COM1/COM1-0201 skipped: flagged for review',
    );
  });

  it('keeps the coordinates of a building that already exists', async () => {
    const existing = await buildings.create({
      canonicalName: 'Computing 1',
      shortName: 'COM1',
      aliases: [],
      latitude: 1.3,
      longitude: 103.78,
    });
    config.VENUE_SEED_PATH = seedFile(miniSeed());

    await venueSeed.load();

    const after = await buildings.findById(existing.id);
    expect([after?.latitude, after?.longitude]).toEqual([1.3, 103.78]);
    // COM1 and the map-pin placeholder.
    expect(await dataSource.getRepository(Building).count()).toBe(2);
    expect(await venues.listActive(existing.id)).toHaveLength(1);
  });

  it('does not duplicate a building that was renamed after it was seeded', async () => {
    await buildings.create({
      canonicalName: 'Blk AS8',
      shortName: 'AS8',
      aliases: [],
      latitude: 1.296252,
      longitude: 103.772093,
    });

    await venueSeed.load();

    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
    const as8 = (await buildings.resolve('AS8'))!;
    expect(as8.canonicalName).toBe('Blk AS8');
    expect(await venues.listActive(as8.id)).not.toHaveLength(0);
  });

  it('adds no venue to a retired building', async () => {
    await venueSeed.load();
    const com1 = (await buildings.resolve('COM1'))!;
    await dataSource.query('TRUNCATE venues');
    await buildings.retire(com1.id);

    const report = await venueSeed.load();

    const com1Venues = SEED.venues.filter(
      (venue) => venue.buildingShortName === 'COM1',
    ).length;
    expect(report.skipped).toBe(com1Venues);
    expect(report.created).toBe(SEED.venues.length - com1Venues);
    expect(
      await dataSource.getRepository(Venue).countBy({ buildingId: com1.id }),
    ).toBe(0);
    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
  });

  it('never brings back a retired venue', async () => {
    config.VENUE_SEED_PATH = seedFile(miniSeed());
    await venueSeed.load();
    const venue = await dataSource.getRepository(Venue).findOneByOrFail({
      code: 'COM1-0201',
    });
    await venues.retire(venue.id);

    await expect(venueSeed.load()).resolves.toMatchObject({
      created: 0,
      alreadyPresent: 1,
    });

    const all = await dataSource.getRepository(Venue).find();
    expect(all).toHaveLength(1);
    expect(all[0]!.retiredAt).not.toBeNull();
  });

  it('adds the venues a later file version introduces, and nothing else', async () => {
    config.VENUE_SEED_PATH = seedFile(miniSeed());
    await venueSeed.load();

    const next = miniSeed();
    next.venues.push({ ...next.venues[0]!, code: 'COM1-0202' });
    config.VENUE_SEED_PATH = seedFile(next);

    await expect(venueSeed.load()).resolves.toMatchObject({
      created: 1,
      alreadyPresent: 1,
    });
  });

  it('is safe when two copies of the service seed at the same time', async () => {
    const [a, b] = await Promise.all([venueSeed.load(), venueSeed.load()]);

    expect(a.created + b.created).toBe(SEED.venues.length);
    expect(await dataSource.getRepository(Venue).count()).toBe(
      SEED.venues.length,
    );
    expect(await dataSource.getRepository(Building).count()).toBe(
      BUILDING_COUNT,
    );
  });

  describe('a bad file', () => {
    it('fails startup when it is malformed', async () => {
      config.VENUE_SEED_PATH = seedFile('{ "buildings": [');

      await expect(venueSeed.onApplicationBootstrap()).rejects.toThrow(
        /not valid JSON/,
      );
      await expect(supplierSeed.importSeed(Buffer.from(''))).rejects.toThrow(
        /not valid JSON/,
      );
    });

    it('fails startup when a venue names an unknown building', async () => {
      config.VENUE_SEED_PATH = seedFile(
        miniSeed({ buildingShortName: 'NOPE' }),
      );

      await expect(venueSeed.onApplicationBootstrap()).rejects.toThrow(
        /unknown building/,
      );
      expect(await dataSource.getRepository(Building).count()).toBe(0);
    });

    it('fails startup when the configured file is missing', async () => {
      config.VENUE_SEED_PATH = '/nowhere/venues-seed.json';

      await expect(venueSeed.onApplicationBootstrap()).rejects.toBeInstanceOf(
        SeedFileUnreadableError,
      );
    });

    it('makes the supplier import log an error and skip, like a missing CSV', async () => {
      config.SEED_ON_STARTUP = true;
      config.VENUE_SEED_PATH = '/nowhere/venues-seed.json';

      await expect(
        supplierSeed.onApplicationBootstrap(),
      ).resolves.toBeUndefined();

      expect(await dataSource.getRepository(Supplier).count()).toBe(0);
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/^Skipping seed import: cannot read /),
      );
    });
  });
});
