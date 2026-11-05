import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@foc/observability';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { environmentSchema } from './config/environment.schema.js';
import { SecretModule } from './secret/secret.module.js';
import { SecretService } from './secret/secret.service.js';
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
    TypeOrmModule.forRootAsync({
      inject: [ConfigService, SecretService],
      useFactory: (
        configService: ConfigService,
        secretService: SecretService,
      ) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: secretService.getDbPassword(),
        database: configService.get<string>('DB_DATABASE'),
        entities: [],
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE'),
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
