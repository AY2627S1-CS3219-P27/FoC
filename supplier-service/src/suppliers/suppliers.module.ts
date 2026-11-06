import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CLOCK, systemClock } from '../common/clock.js';
import { Supplier, SupplierCategory } from '../database/entities/index.js';
import { SupplierQueriesService } from './supplier-queries.service.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, SupplierCategory])],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierQueriesService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [SuppliersService, SupplierQueriesService],
})
export class SuppliersModule {}
