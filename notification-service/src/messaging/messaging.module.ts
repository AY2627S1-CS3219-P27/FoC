import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { InboxModule } from '../inbox/inbox.module.js';
import { InboxConsumer } from './inbox.consumer.js';
import { rabbitMqConnectionUrlProvider } from './rabbitmq-connection-url.provider.js';

@Module({
  imports: [ContractsModule, InboxModule, DispatchModule],
  providers: [rabbitMqConnectionUrlProvider, InboxConsumer],
})
export class MessagingModule {}
