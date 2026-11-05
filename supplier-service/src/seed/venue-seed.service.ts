import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BuildingsService } from '../buildings/buildings.service.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { isUniqueViolation } from '../database/postgres-errors.js';
import { VenuesService } from '../venues/venues.service.js';
import { BuildingSeedService } from './building-seed.service.js';

export interface VenueSeedReport {
  created: number;
  alreadyPresent: number;
  skipped: number;
}

/** A building that may receive venues, with the codes it already has. */
interface OpenBuilding {
  id: string;
  codes: Set<string>;
}

/**
 * Loads the delivery venues from the seed JSON on startup whenever
 * VENUE_SEED_PATH is set, independent of SEED_ON_STARTUP and of whether
 * suppliers exist. Only ever adds: a venue already present (retired or not)
 * is left as it is, a retired building gets none, and rows flagged for review
 * are skipped and logged. Re-running changes nothing. A missing or malformed
 * file fails startup.
 */
@Injectable()
export class VenueSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VenueSeedService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly buildingSeed: BuildingSeedService,
    private readonly buildings: BuildingsService,
    private readonly venues: VenuesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('VENUE_SEED_PATH', { infer: true })) {
      this.logger.debug('Skipping venue seed: VENUE_SEED_PATH is not set.');
      return;
    }
    await this.load();
  }

  async load(): Promise<VenueSeedReport> {
    const seed = await this.buildingSeed.ensure();
    const report: VenueSeedReport = {
      created: 0,
      alreadyPresent: 0,
      skipped: 0,
    };
    // Looked up once per building; null when no venue may be added to it.
    const opened = new Map<string, OpenBuilding | null>();

    for (const venue of seed.venues) {
      if (venue.needsReview) {
        this.logger.warn(
          `seed venue ${venue.buildingShortName}/${venue.code} skipped: flagged for review`,
        );
        report.skipped += 1;
        continue;
      }

      if (!opened.has(venue.buildingShortName)) {
        opened.set(
          venue.buildingShortName,
          await this.open(venue.buildingShortName),
        );
      }
      const building = opened.get(venue.buildingShortName);
      if (!building) {
        report.skipped += 1;
        continue;
      }
      if (building.codes.has(venue.code)) {
        report.alreadyPresent += 1;
        continue;
      }

      try {
        await this.venues.create({
          buildingId: building.id,
          code: venue.code,
          name: venue.name,
          floor: venue.floor,
          latitude: venue.latitude,
          longitude: venue.longitude,
        });
        report.created += 1;
      } catch (error) {
        // Another replica inserted it between the lookup and the insert.
        if (!isUniqueViolation(error, 'UQ_venues_building_code')) {
          throw error;
        }
        report.alreadyPresent += 1;
      }
      building.codes.add(venue.code);
    }

    this.logger.log(
      `venue seed: ${report.created} created, ${report.alreadyPresent} already present, ${report.skipped} skipped`,
    );
    return report;
  }

  private async open(shortName: string): Promise<OpenBuilding | null> {
    const building = await this.buildings.findByAnyName(shortName);
    if (!building || building.retiredAt !== null) {
      this.logger.warn(
        `seed venues for ${shortName} skipped: building ${building ? 'is retired' : 'not found'}`,
      );
      return null;
    }
    // Retired venues count too: they must not come back.
    return { id: building.id, codes: await this.venues.codesIn(building.id) };
  }
}
