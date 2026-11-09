import { Module } from '@nestjs/common';
import { BuildingsModule } from '../buildings/buildings.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { BuildingSeedService } from './building-seed.service.js';
import { SupplierSeedService } from './supplier-seed.service.js';
import { VenueSeedService } from './venue-seed.service.js';

@Module({
  imports: [BuildingsModule, CategoriesModule, SuppliersModule, VenuesModule],
  providers: [BuildingSeedService, SupplierSeedService, VenueSeedService],
})
export class SeedModule {}
