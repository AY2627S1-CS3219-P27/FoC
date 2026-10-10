import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module.js';
import { OutboxRelayLifecycle } from './outbox-relay.lifecycle.js';
import { OutboxRelay } from './outbox.relay.js';
import { OutboxStore } from './outbox.store.js';
import { RabbitMqOutboxPublisher } from './rabbitmq-outbox.publisher.js';

@Module({
  imports: [MessagingModule],
  providers: [
    OutboxStore,
    RabbitMqOutboxPublisher,
    OutboxRelay,
    OutboxRelayLifecycle,
  ],
  exports: [OutboxStore],
})
export class OutboxModule {}
