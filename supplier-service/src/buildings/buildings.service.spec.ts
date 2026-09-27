import { ConflictException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { type Building, BuildingNameKey } from '../database/entities/index.js';
import { BuildingsService } from './buildings.service.js';

function setup(taken: BuildingNameKey[] = []) {
  const manager = {
    find: vi.fn(async () => taken),
    save: vi.fn(async (values: object) => values),
    insert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;
  const buildings = {
    create: vi.fn((values: object) => ({ ...values })),
  } as unknown as Repository<Building>;
  const findNameKey = vi.fn();
  const nameKeys = {
    findOne: findNameKey,
  } as unknown as Repository<BuildingNameKey>;

  return {
    service: new BuildingsService(dataSource, buildings, nameKeys),
    manager,
    findNameKey,
  };
}

const COM2 = {
  canonicalName: ' Computing 2 ',
  shortName: 'COM2',
  aliases: ['Com 2', 'Com2', ' '],
  latitude: 1.2942,
  longitude: 103.7741,
};

describe('BuildingsService', () => {
  it('writes one lookup key per distinct spelling (F4.2, F4.5)', async () => {
    const { service, manager } = setup();

    const building = await service.create(COM2);

    expect(building).toMatchObject({
      canonicalName: 'Computing 2',
      aliases: ['Com 2', 'Com2'],
    });
    // "COM2", "Com 2" and "Com2" all normalise to "com2": stored once.
    expect(manager.insert).toHaveBeenCalledWith(BuildingNameKey, [
      { key: 'computing2', buildingId: building.id },
      { key: 'com2', buildingId: building.id },
    ]);
  });

  it('refuses a name another in-use building already has, naming it', async () => {
    const clash = Object.assign(new BuildingNameKey(), {
      key: 'com2',
      buildingId: 'other',
    });
    const { service, manager } = setup([clash]);

    const error = await service.create(COM2).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_NAME',
      message: expect.stringContaining('com2'),
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('resolves a building from any spelling, ignoring case and spaces', async () => {
    const { service, findNameKey } = setup();
    const building = { id: 'b1' };
    findNameKey.mockResolvedValue({ key: 'com2', buildingId: 'b1', building });

    await expect(service.resolve('  com 2 ')).resolves.toBe(building);
    expect(findNameKey).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'com2' } }),
    );
  });
});
