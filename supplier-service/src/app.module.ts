import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { BuildingsModule } from './buildings/buildings.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { createValidationPipe } from './common/validation/validation.pipe.js';
import { environmentSchema } from './config/environment.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    DatabaseModule,
    // Services only for now; their endpoints arrive once authentication is
    // in place, so no route is ever exposed unprotected.
    BuildingsModule,
    CategoriesModule,
    SuppliersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Registered as providers rather than in main.ts so e2e tests that boot
    // AppModule get exactly the same pipe and filter as production.
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
