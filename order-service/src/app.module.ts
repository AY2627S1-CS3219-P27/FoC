import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/environment.schema.js';
import { DbModule } from './db/db.module.js';
import { LifecycleModule } from './lifecycle/lifecycle.module.js';
import { MessagingModule } from './messaging/messaging.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    DbModule,
    LifecycleModule,
    MessagingModule,
  ],
})
export class AppModule {}
