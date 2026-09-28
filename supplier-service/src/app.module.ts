import { FocAuthModule } from '@foc/auth';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { readJwtPublicKey } from './auth/jwt-public-key.js';
import { BuildingsModule } from './buildings/buildings.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { createValidationPipe } from './common/validation/validation.pipe.js';
import {
  type EnvironmentVariables,
  environmentSchema,
} from './config/environment.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { SeedModule } from './seed/seed.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    // The team's shared access-token verification (@foc/auth, as in
    // user-service): controllers apply JwtAuthGuard / AdminGuard. Only the
    // public key is needed; the signing key never leaves user-service.
    FocAuthModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        publicKey: readJwtPublicKey(
          config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
        ),
      }),
    }),
    DatabaseModule,
    BuildingsModule,
    CategoriesModule,
    SuppliersModule,
    SeedModule,
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
