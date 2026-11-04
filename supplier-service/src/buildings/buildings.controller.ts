import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ErrorCode,
  type FieldViolation,
} from '../common/errors/error-response.js';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import type { Building } from '../database/entities/index.js';
import {
  type CampusBox,
  coordinatesOutsideCampus,
} from '../suppliers/supplier-input.rules.js';
import { BuildingsService } from './buildings.service.js';
import { CreateBuildingDto } from './dto/create-building.dto.js';
import { UpdateBuildingDto } from './dto/update-building.dto.js';

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
  private readonly campus: CampusBox;

  constructor(
    private readonly buildings: BuildingsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.campus = {
      minLatitude: config.get('CAMPUS_MIN_LATITUDE', { infer: true }),
      maxLatitude: config.get('CAMPUS_MAX_LATITUDE', { infer: true }),
      minLongitude: config.get('CAMPUS_MIN_LONGITUDE', { infer: true }),
      maxLongitude: config.get('CAMPUS_MAX_LONGITUDE', { infer: true }),
    };
  }

  /**
   * Non-retired buildings with id, names and coordinates, for selection
   * lists and for other services (F4.4); any authenticated user (F13.3).
   */
  @Get()
  async list(): Promise<BuildingView[]> {
    return (await this.buildings.listActive()).map(toView);
  }

  /**
   * Creates a building (F4.3). Admin only. Its coordinates must lie on
   * campus, and none of its names may belong to another in-use building
   * (409 DUPLICATE_NAME, F4.2).
   */
  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: CreateBuildingDto): Promise<BuildingView> {
    const violations = coordinatesOutsideCampus(body.coordinates, this.campus);
    if (violations.length > 0) {
      throw validationFailed(violations);
    }
    return toView(
      await this.buildings.create({
        canonicalName: body.canonicalName,
        shortName: body.shortName,
        aliases: body.aliases ?? [],
        latitude: body.coordinates.latitude,
        longitude: body.coordinates.longitude,
      }),
    );
  }

  /**
   * Renames a building or replaces its aliases (F4.3). Admin only. A retired
   * building cannot be edited (409); an unknown id is 404.
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', uuidParam('id')) id: string,
    @Body() body: UpdateBuildingDto,
  ): Promise<BuildingView> {
    if (
      body.canonicalName === undefined &&
      body.shortName === undefined &&
      body.aliases === undefined
    ) {
      throw validationFailed([
        { field: '', reason: 'at least one field must be supplied' },
      ]);
    }
    return toView(await this.buildings.updateNames(id, body));
  }

  /**
   * Retires a building (F4.3, F4.3.1). Admin only. Suppliers keep it, but it
   * is no longer listed or selectable, and its names become free. Retiring
   * twice is harmless.
   */
  @Post(':id/retire')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async retire(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<BuildingView> {
    return toView(await this.buildings.retire(id));
  }
}

function validationFailed(violations: FieldViolation[]): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Request validation failed.',
    violations,
  });
}
