import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier, SupplierCategory } from '../database/entities/index.js';
import { SupplierQueriesService } from './supplier-queries.service.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, SupplierCategory])],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierQueriesService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
