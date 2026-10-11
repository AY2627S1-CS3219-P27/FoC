import { Controller, Get } from '@nestjs/common';
import { BuildingsService } from './buildings.service.js';

@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  async list() {
    const buildings = await this.buildingsService.listActive();
    return {
      items: buildings.map((b) => ({
        id: b.id,
        canonicalName: b.canonicalName,
        shortName: b.shortName,
        latitude: b.latitude,
        longitude: b.longitude,
      })),
    };
  }
}
