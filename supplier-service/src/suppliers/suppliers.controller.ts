import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { SupplierStatus } from '../database/entities/index.js';
import { ErrorCode } from '../common/errors/error-response.js';
import { SuppliersService } from './suppliers.service.js';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('name') name?: string,
    @Query('buildingId') buildingId?: string,
    @Query('kind') kind?: string,
  ) {
    const suppliers = await this.suppliersService.list({
      status: status as SupplierStatus | undefined,
      name,
      buildingId,
      kind,
    });

    return {
      items: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        displayName: `${s.name} @ ${s.building?.shortName ?? ''}`,
        kind: s.kind,
        categories:
          s.categoryLinks?.map((link) => ({
            id: link.category?.id,
            name: link.category?.name,
          })) ?? [],
        building: s.building
          ? { id: s.building.id, shortName: s.building.shortName }
          : null,
        floor: s.floor,
        status: s.status,
        photoUrl: s.photoUrl,
        locationDescription: s.locationDescription,
      })),
      total: suppliers.length,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const supplier = await this.suppliersService.findById(id);
    if (!supplier) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: `Supplier ${id} does not exist.`,
      });
    }

    return {
      id: supplier.id,
      name: supplier.name,
      displayName: `${supplier.name} @ ${supplier.building?.shortName ?? ''}`,
      kind: supplier.kind,
      categories:
        supplier.categoryLinks?.map((link) => ({
          id: link.category?.id,
          name: link.category?.name,
        })) ?? [],
      building: supplier.building
        ? {
            id: supplier.building.id,
            canonicalName: supplier.building.canonicalName,
            shortName: supplier.building.shortName,
          }
        : null,
      floor: supplier.floor,
      locationDescription: supplier.locationDescription,
      coordinates: {
        latitude: supplier.latitude,
        longitude: supplier.longitude,
      },
      photoUrl: supplier.photoUrl,
      status: supplier.status,
      version: supplier.version,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }
}
