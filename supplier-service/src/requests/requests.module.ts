import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierRequest } from '../database/entities/index.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { SupplierRequestsController } from './supplier-requests.controller.js';
import { SupplierRequestsService } from './supplier-requests.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([SupplierRequest]), SuppliersModule],
  controllers: [SupplierRequestsController],
  providers: [SupplierRequestsService],
})
export class RequestsModule {}
