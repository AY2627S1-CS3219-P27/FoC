import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@foc/observability';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FocAuthModule } from '@foc/auth';
import { OutboxModule } from '@foc/outbox';
import { AccountInitializationModule } from './account-initialization/account-initialization.module.js';
import { AuthKeyModule } from './auth/auth-key.module.js';
import { AuthKeyService } from './auth/auth-key.service.js';
import {
  environmentSchema,
  type EnvironmentVariables,
} from './config/environment.js';
import { CreditsModule } from './credits/credits.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ReservationModule } from './reservation/reservation.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { RABBITMQ_CONNECTION_URL } from './messaging/rabbitmq-connection-url.provider.js';
import { SettlementModule } from './settlement/settlement.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('credit-service') }),
    AuthKeyModule,
    FocAuthModule.registerAsync({
      imports: [AuthKeyModule],
      inject: [AuthKeyService],
      useFactory: (authKeyService: AuthKeyService) => ({
        publicKey: authKeyService.getJwtPublicKey(),
      }),
    }),
    AccountInitializationModule,
    CreditsModule,
    ReservationModule,
    SettlementModule,
    OutboxModule.forRootAsync({
      imports: [DatabaseModule, MessagingModule],
      inject: [ConfigService, RABBITMQ_CONNECTION_URL],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        rabbitMqUrl: string,
      ) => ({
        exchange: config.getOrThrow('RABBITMQ_EXCHANGE'),
        appId: 'credit-service',
        rabbitMqUrl,
      }),
    }),
  ],
})
export class AppModule {}
