import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Building, BuildingNameKey } from '../database/entities/index.js';
import { BuildingsService } from './buildings.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Building, BuildingNameKey])],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
