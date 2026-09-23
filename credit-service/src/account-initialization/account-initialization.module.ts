import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { AccountInitializationService } from './account-initialization.service.js';
import { UserRegisteredConsumerLifecycle } from './user-registered-consumer.lifecycle.js';
import { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

/** Wires the UserRegistered transport to its atomic account use case. */
@Module({
  imports: [AccountModule, ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    AccountInitializationService,
    UserRegisteredMessageHandler,
    UserRegisteredConsumerLifecycle,
  ],
  exports: [AccountInitializationService, UserRegisteredMessageHandler],
})
export class AccountInitializationModule {}
