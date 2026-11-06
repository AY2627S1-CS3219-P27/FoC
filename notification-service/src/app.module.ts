import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@foc/observability';
import { FocAuthModule } from '@foc/auth';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { SecretModule } from './secret/secret.module.js';
import { SecretService } from './secret/secret.service.js';
import { HealthController } from './health/health.controller.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('notification-service') }),
    SecretModule,
    FocAuthModule.registerAsync({
      imports: [SecretModule],
      inject: [SecretService],
      useFactory: (secretService: SecretService) => ({
        publicKey: secretService.getJwtPublicKey(),
      }),
    }),
    DatabaseModule,
    MessagingModule,
    SubscriptionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
