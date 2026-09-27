import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier, SupplierCategory } from '../database/entities/index.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, SupplierCategory])],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
