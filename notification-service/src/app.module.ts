import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@foc/observability';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment.schema.js';
import { SecretModule } from './secret/secret.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('notification-service') }),
    SecretModule,
    HealthController,
  ],
})
export class AppModule {}
