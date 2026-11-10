import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { AccountInitializationService } from './account-initialization.service.js';
import { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

/** Provides the atomic account use case behind the UserRegistered event. */
@Module({
  imports: [AccountModule, ContractsModule, DatabaseModule, MessagingModule],
  providers: [
    AccountInitializationService,
    UserRegisteredMessageHandler,
  ],
  exports: [AccountInitializationService, UserRegisteredMessageHandler],
})
export class AccountInitializationModule {}
