import { JwtAuthGuard } from '@foc/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { Building } from '../database/entities/index.js';
import { BuildingsService } from './buildings.service.js';

export interface BuildingView {
  id: string;
  canonicalName: string;
  shortName: string;
  aliases: string[];
  coordinates: { latitude: number; longitude: number };
}

function toView(building: Building): BuildingView {
  return {
    id: building.id,
    canonicalName: building.canonicalName,
    shortName: building.shortName,
    aliases: building.aliases,
    coordinates: {
      latitude: building.latitude,
      longitude: building.longitude,
    },
  };
}

/** Every route requires a valid user-service access token (F13.2). */
@Controller('buildings')
@UseGuards(JwtAuthGuard)
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  /**
   * Non-retired buildings with id, names and coordinates, for selection
   * lists and for other services (F4.4); any authenticated user (F13.3).
   */
  @Get()
  async list(): Promise<BuildingView[]> {
    return (await this.buildings.listActive()).map(toView);
  }
}
