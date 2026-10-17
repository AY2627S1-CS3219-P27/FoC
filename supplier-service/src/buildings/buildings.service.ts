import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  In,
  IsNull,
  Not,
  type Repository,
} from 'typeorm';
import { ErrorCode } from '../common/errors/error-response.js';
import { buildingKey } from '../common/normalise/normalise.js';
import { Building, BuildingNameKey } from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';

export interface CreateBuildingInput {
  canonicalName: string;
  shortName: string;
  aliases: string[];
  latitude: number;
  longitude: number;
}

export interface BuildingNameChanges {
  canonicalName?: string;
  shortName?: string;
  aliases?: string[];
}

/**
 * The controlled list of campus buildings (F4). Every name, short name and
 * alias of a non-retired building is also written to building_name_keys, in
 * the same transaction, so the database rejects a name shared between two
 * in-use buildings (F4.2) and any spelling resolves in one lookup (F4.5).
 */
@Injectable()
export class BuildingsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Building)
    private readonly buildings: Repository<Building>,
    @InjectRepository(BuildingNameKey)
    private readonly nameKeys: Repository<BuildingNameKey>,
  ) {}

  /** Non-retired buildings, for selection lists and other services (F4.4). */
  listActive(): Promise<Building[]> {
    return this.buildings.find({
      where: { retiredAt: IsNull() },
      order: { canonicalName: 'ASC' },
    });
  }

  findById(id: string): Promise<Building | null> {
    return this.buildings.findOneBy({ id });
  }

  /**
   * The non-retired building known by this canonical name, short name or
   * alias, ignoring case and whitespace (F4.5); null when none is.
   */
  async resolve(name: string): Promise<Building | null> {
    const match = await this.nameKeys.findOne({
      where: { key: buildingKey(name) },
      relations: { building: true },
    });
    return match?.building ?? null;
  }

  /**
   * The building known by this canonical name, short name or alias, retired
   * or not, ignoring case, whitespace and apostrophe style; the in-use one
   * first. Unlike resolve(), it also finds retired buildings, so the seed
   * never creates again a building an admin retired.
   */
  async findByAnyName(name: string): Promise<Building | null> {
    const key = buildingKey(name);
    const all = await this.buildings.find({ order: { createdAt: 'DESC' } });
    const matches = all.filter((building) =>
      [building.canonicalName, building.shortName, ...building.aliases]
        .map(buildingKey)
        .includes(key),
    );
    return (
      matches.find((building) => building.retiredAt === null) ??
      matches[0] ??
      null
    );
  }

  async create(input: CreateBuildingInput): Promise<Building> {
    const building = this.buildings.create({
      id: randomUUID(),
      canonicalName: input.canonicalName.trim(),
      shortName: input.shortName.trim(),
      aliases: cleanAliases(input.aliases),
      latitude: input.latitude,
      longitude: input.longitude,
      retiredAt: null,
    });

    return this.withDuplicateNamesMapped(() =>
      this.dataSource.transaction(async (manager) => {
        await this.assertNamesFree(manager, building);
        const saved = await manager.save(building);
        await this.writeNameKeys(manager, saved);
        return saved;
      }),
    );
  }

  /** Renames a building or replaces its aliases (F4.3). */
  async updateNames(
    id: string,
    changes: BuildingNameChanges,
  ): Promise<Building> {
    return this.withDuplicateNamesMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const building = await this.lockActive(manager, id);
        if (changes.canonicalName !== undefined) {
          building.canonicalName = changes.canonicalName.trim();
        }
        if (changes.shortName !== undefined) {
          building.shortName = changes.shortName.trim();
        }
        if (changes.aliases !== undefined) {
          building.aliases = cleanAliases(changes.aliases);
        }

        await this.assertNamesFree(manager, building);
        const saved = await manager.save(building);
        await manager.delete(BuildingNameKey, { buildingId: id });
        await this.writeNameKeys(manager, saved);
        return saved;
      }),
    );
  }

  /**
   * Retires a building (F4.3): it stays on suppliers already referencing it
   * (F1.8, F4.3.1) but is no longer listed or selectable, and its names become
   * free for another building. Retiring an already retired building is a
   * no-op.
   */
  async retire(id: string): Promise<Building> {
    return this.dataSource.transaction(async (manager) => {
      const building = await manager.findOne(Building, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!building) {
        throw buildingNotFound(id);
      }
      if (building.retiredAt !== null) {
        return building;
      }

      building.retiredAt = new Date();
      const saved = await manager.save(building);
      await manager.delete(BuildingNameKey, { buildingId: id });
      return saved;
    });
  }

  private async lockActive(
    manager: EntityManager,
    id: string,
  ): Promise<Building> {
    const building = await manager.findOne(Building, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!building) {
      throw buildingNotFound(id);
    }
    if (building.retiredAt !== null) {
      throw new ConflictException({
        code: ErrorCode.Conflict,
        message: 'A retired building cannot be edited.',
      });
    }
    return building;
  }

  /**
   * Names the clashing spellings up front for a helpful 409. The primary key
   * on building_name_keys still decides races (withDuplicateNamesMapped).
   */
  private async assertNamesFree(
    manager: EntityManager,
    building: Building,
  ): Promise<void> {
    const taken = await manager.find(BuildingNameKey, {
      where: { key: In(nameKeysOf(building)), buildingId: Not(building.id) },
    });
    if (taken.length > 0) {
      throw duplicateNames(taken.map((row) => row.key));
    }
  }

  private async writeNameKeys(
    manager: EntityManager,
    building: Building,
  ): Promise<void> {
    await manager.insert(
      BuildingNameKey,
      nameKeysOf(building).map((key) => ({ key, buildingId: building.id })),
    );
  }

  private async withDuplicateNamesMapped<T>(
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error, 'PK_building_name_keys')) {
        throw duplicateNames([]);
      }
      throw error;
    }
  }
}

/** The distinct lookup keys for all of a building's names. */
function nameKeysOf(building: Building): string[] {
  return [
    ...new Set(
      [building.canonicalName, building.shortName, ...building.aliases].map(
        buildingKey,
      ),
    ),
  ];
}

function cleanAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

function buildingNotFound(id: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: `Building ${id} does not exist.`,
  });
}

function duplicateNames(keys: string[]): ConflictException {
  const which = keys.length > 0 ? ` (${keys.join(', ')})` : '';
  return new ConflictException({
    code: ErrorCode.DuplicateName,
    message: `A name, short name or alias is already used by another building${which}.`,
  });
}
