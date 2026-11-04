import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import {
  AMQP_CONNECT,
  amqpConnectionProvider,
} from './amqp-connection.provider.js';
import { NotifyConsumer } from './notify-consumer.service.js';
import {
  rabbitMqConnectionUrlProvider,
  RABBITMQ_CONNECTION_URL,
} from './rabbitmq-connection-url.provider.js';

@Module({
  imports: [NotificationsModule],
  providers: [
    amqpConnectionProvider,
    rabbitMqConnectionUrlProvider,
    NotifyConsumer,
  ],
  exports: [AMQP_CONNECT, RABBITMQ_CONNECTION_URL],
})
export class MessagingModule {}
