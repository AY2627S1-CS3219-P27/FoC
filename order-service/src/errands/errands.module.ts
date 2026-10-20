import { Module } from '@nestjs/common';
import { LifecycleModule } from '../lifecycle/lifecycle.module.js';
import { ErrandsController } from './errands.controller.js';
import { ErrandsQueryService } from './errands.query.js';

// The errand HTTP routes. LifecycleModule lends LifecycleService; the guards
// (FocAuthModule) and the DB (DbModule) are global, so need no import here.
@Module({
  imports: [LifecycleModule],
  controllers: [ErrandsController],
  providers: [ErrandsQueryService],
})
export class ErrandsModule {}
