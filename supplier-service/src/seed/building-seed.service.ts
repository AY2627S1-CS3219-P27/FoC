import { readFile } from 'node:fs/promises';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BuildingsService } from '../buildings/buildings.service.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  SeedFileUnreadableError,
  type VenueSeedFile,
  parseVenueSeed,
} from './venue-seed-file.js';

/**
 * The shared, idempotent building step of the seeds: reads the seed JSON and
 * creates every building it lists that is not there yet. Both the supplier
 * importer and the venue loader call it, so neither depends on startup order
 * or on the other being configured.
 */
@Injectable()
export class BuildingSeedService {
  private readonly logger = new Logger(BuildingSeedService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly buildings: BuildingsService,
  ) {}

  /**
   * Creates any seed building not yet present and returns the parsed file.
   * A building that exists under any of its names, retired or not, is left
   * alone: its coordinates are never moved and a retired one never returns.
   * Throws SeedFileUnreadableError when the file cannot be read, and a plain
   * Error when it is malformed.
   */
  async ensure(): Promise<VenueSeedFile> {
    const seed = await this.read();

    for (const building of seed.buildings) {
      if (await this.exists(building)) {
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
          `seed building ${building.canonicalName} not created: ${error.message}`,
        );
      }
    }
    return seed;
  }

  private async read(): Promise<VenueSeedFile> {
    const path = this.config.get('VENUE_SEED_PATH', { infer: true });
    if (!path) {
      throw new SeedFileUnreadableError('VENUE_SEED_PATH is not set');
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw new SeedFileUnreadableError(
        `cannot read ${path} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    return parseVenueSeed(bytes);
  }

  /** Resolves by any of the building's names, so a rename never duplicates it. */
  private async exists(building: VenueSeedFile['buildings'][number]) {
    for (const name of [
      building.canonicalName,
      building.shortName,
      ...building.aliases,
    ]) {
      if (await this.buildings.findByAnyName(name)) {
        return true;
      }
    }
    return false;
  }
}
