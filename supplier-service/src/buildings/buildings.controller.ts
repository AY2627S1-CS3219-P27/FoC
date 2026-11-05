import { JwtAuthGuard } from '@foc/auth';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-response.js';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import type { Building, Venue } from '../database/entities/index.js';
import { VenuesService } from '../venues/venues.service.js';
import { BuildingsService } from './buildings.service.js';

export interface BuildingView {
  id: string;
  canonicalName: string;
  shortName: string;
  aliases: string[];
  coordinates: { latitude: number; longitude: number };
  /** Active venues only; 0 means there is no venue step to show. */
  venueCount: number;
  /** True only for the "Other (map pin)" placeholder: show the pin map, not a venue step. */
  allowsPin: boolean;
}

export interface VenueView {
  id: string;
  code: string;
  name: string | null;
  floor: string;
  coordinates: { latitude: number; longitude: number };
}

function toView(building: Building, venueCount: number): BuildingView {
  return {
    id: building.id,
    canonicalName: building.canonicalName,
    shortName: building.shortName,
    aliases: building.aliases,
    coordinates: {
      latitude: building.latitude,
      longitude: building.longitude,
    },
    venueCount,
    allowsPin: building.allowsPin,
  };
}

function toVenueView(venue: Venue): VenueView {
  return {
    id: venue.id,
    code: venue.code,
    name: venue.name,
    floor: venue.floor,
    coordinates: { latitude: venue.latitude, longitude: venue.longitude },
  };
}

/** Every route requires a valid user-service access token (F13.2). */
@Controller('buildings')
@UseGuards(JwtAuthGuard)
export class BuildingsController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly venues: VenuesService,
  ) {}

  /**
   * Non-retired buildings with id, names, coordinates, active venue count and
   * the map-pin flag, for selection lists and for other services (F4.4); any authenticated user
   * (F13.3).
   */
  @Get()
  async list(): Promise<BuildingView[]> {
    const [buildings, counts] = await Promise.all([
      this.buildings.listActive(),
      this.venues.countActiveByBuilding(),
    ]);
    return buildings.map((building) =>
      toView(building, counts.get(building.id) ?? 0),
    );
  }

  /** A building's active venues, in picking order; 404 if it is unknown or retired. */
  @Get(':id/venues')
  async listVenues(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<VenueView[]> {
    if (!(await this.buildings.findInUseById(id))) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: `Building ${id} does not exist.`,
      });
    }
    return (await this.venues.listActive(id)).map(toVenueView);
  }
}
