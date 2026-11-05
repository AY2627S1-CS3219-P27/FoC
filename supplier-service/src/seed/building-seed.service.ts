import { readFile } from 'node:fs/promises';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BuildingsService,
  type CreateBuildingInput,
} from '../buildings/buildings.service.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  SeedFileUnreadableError,
  type VenueSeedFile,
  parseVenueSeed,
} from './venue-seed-file.js';

/**
 * The placeholder an errand points at when the requester drops a map pin
 * instead of choosing a building. Defined here, not in the seed JSON, so it
 * exists whether or not that file is configured. The coordinates are a fixed
 * point at the centre of the default campus bounds; the pin's own position is
 * order-service's concern.
 */
const PIN_BUILDING: CreateBuildingInput = {
  canonicalName: 'Other (map pin)',
  shortName: 'PIN',
  aliases: [],
  latitude: 1.295,
  longitude: 103.765,
  allowsPin: true,
};

/**
 * The shared, idempotent building step of the seeds: creates the map-pin
 * placeholder, then reads the seed JSON and creates every building it lists
 * that is not there yet. Both the supplier importer and the venue loader call
 * it, so neither depends on startup order or on the other being configured.
 * The placeholder is also created on every startup by itself, so it never
 * depends on VENUE_SEED_PATH or SEED_ON_STARTUP.
 */
@Injectable()
export class BuildingSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuildingSeedService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly buildings: BuildingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.createIfMissing(PIN_BUILDING);
  }

  /**
   * Creates any seed building not yet present, and the map-pin placeholder,
   * and returns the parsed file. A building that exists under any of its
   * names, retired or not, is left alone: its coordinates are never moved and
   * a retired one never returns. Throws SeedFileUnreadableError when the file
   * cannot be read, and a plain Error when it is malformed (before anything
   * is created).
   */
  async ensure(): Promise<VenueSeedFile> {
    const seed = await this.read();

    await this.createIfMissing(PIN_BUILDING);
    for (const building of seed.buildings) {
      await this.createIfMissing(building);
    }
    return seed;
  }

  private async createIfMissing(building: CreateBuildingInput): Promise<void> {
    if (await this.exists(building)) {
      return;
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
  private async exists(building: CreateBuildingInput) {
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
