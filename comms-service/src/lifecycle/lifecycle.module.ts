import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { LifecycleConsumerLifecycle } from './lifecycle-consumer.lifecycle.js';
import { LifecycleFactQueryService } from './lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from './lifecycle-ingestion.service.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

@Module({
  imports: [ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    LifecycleIngestionService,
    LifecycleFactQueryService,
    LifecycleMessageDispatcher,
    LifecycleConsumerLifecycle,
  ],
  exports: [
    LifecycleIngestionService,
    LifecycleFactQueryService,
    LifecycleMessageDispatcher,
  ],
})
export class LifecycleModule {}
