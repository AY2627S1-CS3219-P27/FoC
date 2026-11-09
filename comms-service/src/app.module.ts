import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FocAuthModule } from '@foc/auth';
import { pinoHttpOptions } from '@foc/observability';
import { LoggerModule } from 'nestjs-pino';
import { AuthKeyModule } from './auth/auth-key.module.js';
import { AuthKeyService } from './auth/auth-key.service.js';
import { ArchiveModule } from './archive/archive.module.js';
import { ChatsModule } from './chats/chats.module.js';
import { environmentSchema } from './config/environment.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SocketModule } from './socket/socket.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('comms-service') }),
    DatabaseModule,
    ArchiveModule,
    MessagingModule,
    RedisModule,
    ContractsModule,
    LifecycleModule,
    ChatsModule,
    SocketModule,
    AuthKeyModule,
    FocAuthModule.registerAsync({
      imports: [AuthKeyModule],
      inject: [AuthKeyService],
      useFactory: (authKeyService: AuthKeyService) => ({
        publicKey: authKeyService.getJwtPublicKey(),
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
