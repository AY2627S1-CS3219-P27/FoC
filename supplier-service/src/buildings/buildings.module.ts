import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Building, BuildingNameKey } from '../database/entities/index.js';
import { VenuesModule } from '../venues/venues.module.js';
import { BuildingsController } from './buildings.controller.js';
import { BuildingsService } from './buildings.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Building, BuildingNameKey]),
    VenuesModule,
  ],
  controllers: [BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
