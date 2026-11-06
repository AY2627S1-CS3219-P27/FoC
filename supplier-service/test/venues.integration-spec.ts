import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  Building,
  BuildingNameKey,
  Venue,
} from '../src/database/entities/index.js';
import { VenuesService } from '../src/venues/venues.service.js';

describe('venues (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let buildings: BuildingsService;
  let venues: VenuesService;

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

    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    venues = new VenuesService(dataSource.getRepository(Venue));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE venues, building_name_keys, buildings, supplier_categories, suppliers, supplier_requests CASCADE`,
    );
  });

  const building = (shortName: string) =>
    buildings.create({
      canonicalName: `Building ${shortName}`,
      shortName,
      aliases: [],
      latitude: 1.2949,
      longitude: 103.7743,
    });

  const venueAt = (
    buildingId: string,
    code: string,
    floor: string,
    name: string | null = null,
  ) =>
    venues.create({
      buildingId,
      code,
      name,
      floor,
      latitude: 1.295,
      longitude: 103.774,
    });

  describe('listActive', () => {
    it('lists basements first, then numeric floors, then code', async () => {
      const com1 = await building('COM1');
      await venueAt(com1.id, 'Z', '2');
      await venueAt(com1.id, 'B', '10');
      await venueAt(com1.id, 'A', '2');
      await venueAt(com1.id, 'C', 'B1');
      await venueAt(com1.id, 'D', 'B2');
      await venueAt(com1.id, 'E', '1');

      const listed = await venues.listActive(com1.id);

      expect(listed.map(({ code }) => code)).toEqual([
        'D', // B2 is deeper than B1
        'C',
        'E',
        'A',
        'Z',
        'B', // floor 10 sorts numerically, after floor 2
      ]);
    });

    it('orders codes naturally, so LT2 comes before LT10', async () => {
      const com1 = await building('COM1');
      await venueAt(com1.id, 'LT10', '1');
      await venueAt(com1.id, 'LT2', '1');
      await venueAt(com1.id, 'LT1', '1');

      const listed = await venues.listActive(com1.id);

      expect(listed.map(({ code }) => code)).toEqual(['LT1', 'LT2', 'LT10']);
    });

    it('hides retired venues and other buildings', async () => {
      const com1 = await building('COM1');
      const com2 = await building('COM2');
      await venueAt(com1.id, 'LT15', '1');
      const old = await venueAt(com1.id, 'OLD', '1');
      await venueAt(com2.id, 'SR1', '1');
      await venues.retire(old.id);

      const listed = await venues.listActive(com1.id);

      expect(listed.map(({ code }) => code)).toEqual(['LT15']);
    });
  });

  describe('countActiveByBuilding', () => {
    it('counts active venues per building, leaving out buildings with none', async () => {
      const com1 = await building('COM1');
      const com2 = await building('COM2');
      const com3 = await building('COM3');
      await venueAt(com1.id, 'A', '1');
      await venueAt(com1.id, 'B', '1');
      const old = await venueAt(com1.id, 'C', '1');
      await venueAt(com2.id, 'A', '1');
      await venues.retire(old.id);
      // com3 has only a retired venue
      await venues.retire((await venueAt(com3.id, 'A', '1')).id);

      const counts = await venues.countActiveByBuilding();

      expect(counts.get(com1.id)).toBe(2);
      expect(counts.get(com2.id)).toBe(1);
      expect(counts.get(com3.id) ?? 0).toBe(0);
    });
  });

  describe('findInUse', () => {
    it('finds an active venue only within its own building', async () => {
      const com1 = await building('COM1');
      const com2 = await building('COM2');
      const venue = await venueAt(com1.id, 'LT15', '1', 'Lecture Theatre 15');

      await expect(venues.findInUse(com1.id, venue.id)).resolves.toMatchObject({
        id: venue.id,
        code: 'LT15',
        name: 'Lecture Theatre 15',
      });
      await expect(venues.findInUse(com2.id, venue.id)).resolves.toBeNull();
    });

    it('does not find an unknown or retired venue', async () => {
      const com1 = await building('COM1');
      const venue = await venueAt(com1.id, 'LT15', '1');
      await venues.retire(venue.id);

      await expect(venues.findInUse(com1.id, venue.id)).resolves.toBeNull();
      await expect(
        venues.findInUse(com1.id, '00000000-0000-4000-8000-000000000000'),
      ).resolves.toBeNull();
    });

    it('reads on the given transaction', async () => {
      const com1 = await building('COM1');
      const venue = await venueAt(com1.id, 'LT15', '1');

      const found = await dataSource.transaction((manager) =>
        venues.findInUse(com1.id, venue.id, manager),
      );

      expect(found?.id).toBe(venue.id);
    });
  });

  describe('retire', () => {
    it('keeps the row and is a no-op the second time', async () => {
      const com1 = await building('COM1');
      const venue = await venueAt(com1.id, 'LT15', '1');

      const first = await venues.retire(venue.id);
      const second = await venues.retire(venue.id);

      expect(first.retiredAt).toBeInstanceOf(Date);
      expect(second.retiredAt).toEqual(first.retiredAt);
    });
  });

  describe('create', () => {
    it('stores the floor and trims the code', async () => {
      const com1 = await building('COM1');

      const venue = await venueAt(com1.id, '  LT15 ', 'b1');

      expect(venue).toMatchObject({ code: 'LT15', floor: 'B1', name: null });
    });
  });
});
