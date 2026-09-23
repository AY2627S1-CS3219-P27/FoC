import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createObserveModule } from '@nestjs/observe';
import { OtpModule } from './otp/otp.module.js';
import { environmentSchema } from './config/environment.schema.js';
import { AuthModule } from './auth/auth.module.js';
import { SecretModule } from './secret/secret.module.js';
import { SecretService } from './secret/secret.service.js';
import { User } from './users/user.entity.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'user-service',
    }),
    SecretModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService, SecretService],
      useFactory: (configService: ConfigService, secretService: SecretService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: secretService.getDbPassword(),
        database: configService.get<string>('DB_DATABASE'),
        entities: [User],
        // Dev convenience only: derive the schema from the entities on startup.
        // Production should move to explicit migrations.
        synchronize: configService.get<string>('NODE_ENV') === 'development',
      }),
    }),
    OtpModule,
    AuthModule,
  ],
})
export class AppModule {}