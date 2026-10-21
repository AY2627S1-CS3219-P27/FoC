import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';
import { AdminErrandsController } from './admin-errands.controller.js';
import { ErrandsController } from './errands.controller.js';
import { ErrandsQueryService } from './errands.query.js';

// The errand HTTP routes. LifecycleModule lends LifecycleService; the guards
// (FocAuthModule) and the DB (DbModule) are global, so need no import here.
@Module({
  imports: [LifecycleModule],
  controllers: [ErrandsController, AdminErrandsController],
  providers: [ErrandsQueryService],
})
export class ErrandsModule {}
