import { readFile } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BuildingsService } from '../buildings/buildings.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import {
  ErrorCode,
  type FieldViolation,
} from '../common/errors/error-response.js';
import { nameKey } from '../common/normalise/normalise.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import type { Building } from '../database/entities/index.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import { SEED_BUILDINGS } from './reference-data.js';
import { type SeedCsvRow, readSeedCsv } from './seed-csv.js';
import {
  SEED_COLUMNS,
  categoryNamesOf,
  seedSupplierName,
  splitBuildingSuffix,
  toSupplierInput,
} from './seed-row.mapper.js';

export interface SeedReport {
  created: number;
  alreadyPresent: number;
  rejected: number;
}

type RowOutcome = keyof SeedReport;

/**
 * Pre-populates suppliers from the template's seed file on startup (F12).
 * Runs after migrations, like user-service's admin bootstrap. Every row goes
 * through the same SuppliersService.create as the admin API (F12.3), so the
 * duplicate constraint makes re-running safe (F12.1), and a bad row is
 * skipped and reported without stopping the import (F12.4).
 */
@Injectable()
export class SupplierSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SupplierSeedService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly buildings: BuildingsService,
    private readonly categories: CategoriesService,
    private readonly suppliers: SuppliersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('SEED_ON_STARTUP', { infer: true })) {
      this.logger.debug('Skipping seed import: SEED_ON_STARTUP is false.');
      return;
    }

    const path = this.config.get('SEED_CSV_PATH', { infer: true });
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      // A missing seed file must not stop the service from serving.
      this.logger.error(
        `Skipping seed import: cannot read ${path} (${error instanceof Error ? error.message : String(error)}).`,
      );
      return;
    }
    await this.importSeed(bytes);
  }

  async importSeed(bytes: Uint8Array): Promise<SeedReport> {
    await this.ensureBuildings();

    const report: SeedReport = { created: 0, alreadyPresent: 0, rejected: 0 };
    const categoryIds = new Map<string, string>();
    for (const row of readSeedCsv(bytes)) {
      report[await this.importRow(row, categoryIds)] += 1;
    }

    this.logger.log(
      `seed: ${report.created} created, ${report.alreadyPresent} already present, ${report.rejected} rejected`,
    );
    return report;
  }

  /** Creates any seed building not yet present (F12.2.1). */
  private async ensureBuildings(): Promise<void> {
    for (const building of SEED_BUILDINGS) {
      if (await this.buildings.resolve(building.canonicalName)) {
        continue;
      }
      try {
        await this.buildings.create(building);
      } catch (error) {
        // Another replica created it first, or an admin building already
        // uses one of its names: keep going with what exists.
        if (!(error instanceof ConflictException)) {
          throw error;
        }
        this.logger.warn(
          `seed building ${building.canonicalName} not created: ${messageOf(error)}`,
        );
      }
    }
  }

  private async importRow(
    row: SeedCsvRow,
    categoryIds: Map<string, string>,
  ): Promise<RowOutcome> {
    const seedName = row.values[SEED_COLUMNS.name] ?? '';
    const reject = (violations: FieldViolation[]): RowOutcome => {
      this.logger.warn(
        `seed row ${row.line} (${seedName || 'unnamed'}) rejected: ${violations
          .map(({ field, reason }) => `${field}: ${reason}`)
          .join('; ')}`,
      );
      return 'rejected';
    };

    if (row.cellCountMismatch) {
      const { expected, found } = row.cellCountMismatch;
      return reject([
        { field: 'row', reason: `expected ${expected} cells, found ${found}` },
      ]);
    }

    const buildingName = row.values[SEED_COLUMNS.building] ?? '';
    const building = buildingName
      ? await this.buildings.resolve(buildingName)
      : null;
    if (!building) {
      return reject([
        {
          field: SEED_COLUMNS.building,
          reason: `unknown building "${buildingName}"`,
        },
      ]);
    }

    const input = toSupplierInput(row.values, {
      name: seedSupplierName(
        seedName,
        await this.stripOwnBuildingSuffix(seedName, building),
      ),
      buildingId: building.id,
      categoryIds: await this.ensureCategories(
        categoryNamesOf(row.values[SEED_COLUMNS.type] ?? ''),
        categoryIds,
      ),
    });

    try {
      await this.suppliers.create(input);
      return 'created';
    } catch (error) {
      if (
        error instanceof ConflictException &&
        codeOf(error) === ErrorCode.DuplicateSupplier
      ) {
        return 'alreadyPresent';
      }
      if (error instanceof BadRequestException) {
        return reject(violationsOf(error));
      }
      throw error;
    }
  }

  /** "Printer @ Com 2" in Com 2 becomes "Printer" (F12.2.6). */
  private async stripOwnBuildingSuffix(
    seedName: string,
    building: Building,
  ): Promise<string> {
    const split = splitBuildingSuffix(seedName);
    if (!split) {
      return seedName;
    }
    const named = await this.buildings.resolve(split.suffix);
    return named?.id === building.id ? split.base : seedName;
  }

  /** Ids for the named categories, creating missing ones (F12.2.2). */
  private async ensureCategories(
    names: string[],
    cache: Map<string, string>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) {
      const key = nameKey(name);
      let id = cache.get(key);
      if (id === undefined) {
        const category =
          (await this.categories.findActiveByName(name)) ??
          (await this.createCategory(name));
        id = category.id;
        cache.set(key, id);
      }
      ids.push(id);
    }
    return ids;
  }

  private async createCategory(name: string) {
    try {
      return await this.categories.create(name);
    } catch (error) {
      // Another replica created it between the lookup and the insert.
      const existing =
        error instanceof ConflictException
          ? await this.categories.findActiveByName(name)
          : null;
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }
}

function responseOf(error: ConflictException | BadRequestException) {
  const response = error.getResponse();
  return (
    typeof response === 'object' && response !== null ? response : {}
  ) as { code?: unknown; violations?: FieldViolation[]; message?: unknown };
}

function codeOf(error: ConflictException): unknown {
  return responseOf(error).code;
}

function violationsOf(error: BadRequestException): FieldViolation[] {
  return (
    responseOf(error).violations ?? [{ field: 'row', reason: messageOf(error) }]
  );
}

function messageOf(error: ConflictException | BadRequestException): string {
  const { message } = responseOf(error);
  return typeof message === 'string' ? message : error.message;
}
