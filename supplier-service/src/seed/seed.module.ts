import { Module } from '@nestjs/common';
import { BuildingsModule } from '../buildings/buildings.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { SupplierSeedService } from './supplier-seed.service.js';

@Module({
  imports: [BuildingsModule, CategoriesModule, SuppliersModule],
  providers: [SupplierSeedService],
})
export class SeedModule {}
