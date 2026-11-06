import { ConflictException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { recordAudit } from '../audit/record-audit.js';
import { type Building, BuildingNameKey } from '../database/entities/index.js';
import { BuildingsService } from './buildings.service.js';

// The audit log is covered against a real database (test/audit-writes).
vi.mock('../audit/record-audit.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

function setup(
  taken: BuildingNameKey[] = [],
  existing: Record<string, unknown> | null = null,
) {
  const manager = {
    find: vi.fn(async () => taken),
    findOne: vi.fn(async () => existing),
    save: vi.fn(async (values: object) => values),
    insert: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  } as unknown as DataSource;
  const findRetired = vi.fn(async () => [] as object[]);
  const buildings = {
    create: vi.fn((values: object) => ({ ...values })),
    find: findRetired,
  } as unknown as Repository<Building>;
  const findNameKey = vi.fn();
  const nameKeys = {
    findOne: findNameKey,
  } as unknown as Repository<BuildingNameKey>;

  return {
    service: new BuildingsService(dataSource, buildings, nameKeys),
    manager,
    findNameKey,
    findRetired,
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

  it('records a creation in the audit log, on the same transaction (F14.4)', async () => {
    const { service, manager } = setup();

    const building = await service.create(COM2);

    expect(recordAudit).toHaveBeenLastCalledWith(manager, {
      action: 'building.created',
      targetType: 'building',
      targetId: building.id,
      after: {
        id: building.id,
        canonicalName: 'Computing 2',
        shortName: 'COM2',
        aliases: ['Com 2', 'Com2'],
        coordinates: { latitude: 1.2942, longitude: 103.7741 },
        retiredAt: null,
      },
    });
  });

  it('records nothing when a creation is refused (F14.4)', async () => {
    vi.mocked(recordAudit).mockClear();
    const clash = Object.assign(new BuildingNameKey(), {
      key: 'com2',
      buildingId: 'other',
    });
    const { service } = setup([clash]);

    await expect(service.create(COM2)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(recordAudit).not.toHaveBeenCalled();
  });

  describe('edits and retiring', () => {
    const live = () => ({
      id: 'b1',
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases: ['Com 2'],
      latitude: 1.2942,
      longitude: 103.7741,
      retiredAt: null,
    });

    it('records an edit with the building before and after (F14.4)', async () => {
      vi.mocked(recordAudit).mockClear();
      const { service, manager } = setup([], live());

      await service.updateNames('b1', { shortName: 'C2' });

      expect(recordAudit).toHaveBeenCalledExactlyOnceWith(manager, {
        action: 'building.updated',
        targetType: 'building',
        targetId: 'b1',
        before: expect.objectContaining({ shortName: 'COM2' }),
        after: expect.objectContaining({ shortName: 'C2' }),
      });
    });

    it('records retiring once, and nothing for a building already retired', async () => {
      vi.mocked(recordAudit).mockClear();
      const first = setup([], live());
      await first.service.retire('b1');

      expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
        first.manager,
        expect.objectContaining({
          action: 'building.retired',
          before: expect.objectContaining({ retiredAt: null }),
          after: expect.objectContaining({
            retiredAt: expect.any(String),
          }),
        }),
      );

      vi.mocked(recordAudit).mockClear();
      const again = setup([], { ...live(), retiredAt: new Date() });
      await again.service.retire('b1');
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it('records nothing for an unknown or a retired building', async () => {
      vi.mocked(recordAudit).mockClear();

      await expect(
        setup([], null).service.updateNames('nope', { shortName: 'X' }),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        setup([], { ...live(), retiredAt: new Date() }).service.updateNames(
          'b1',
          { shortName: 'X' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(recordAudit).not.toHaveBeenCalled();
    });
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

  it('finds an in-use building by its name key without scanning (findByAnyName)', async () => {
    const { service, findNameKey, findRetired } = setup();
    const building = { id: 'b1' };
    findNameKey.mockResolvedValue({ key: 'com2', buildingId: 'b1', building });

    await expect(service.findByAnyName('Com 2')).resolves.toBe(building);
    expect(findRetired).not.toHaveBeenCalled();
  });

  it('falls back to retired buildings when no in-use one has the name', async () => {
    const { service, findNameKey, findRetired } = setup();
    const retired = {
      id: 'old',
      canonicalName: 'Old Block',
      shortName: 'OB',
      aliases: ['The Old Block'],
      retiredAt: new Date(),
    };
    findNameKey.mockResolvedValue(null);
    findRetired.mockResolvedValue([retired]);

    await expect(service.findByAnyName(' the  old block ')).resolves.toBe(
      retired,
    );
    await expect(service.findByAnyName('Nowhere')).resolves.toBeNull();
  });
});
