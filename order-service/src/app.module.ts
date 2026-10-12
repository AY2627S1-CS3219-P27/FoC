import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment.schema.js';
import { CreditRepliesModule } from './credit-replies/credit-replies.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { SweepsModule } from './sweeps/sweeps.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    DbModule,
    CreditRepliesModule,
    LifecycleModule,
    MessagingModule,
    OutboxModule,
    SweepsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
