import { Module } from '@nestjs/common';
import {
  AMQP_CONNECT,
  amqpConnectionProvider,
} from './amqp-connection.provider.js';
import {
  rabbitMqConnectionUrlProvider,
  RABBITMQ_CONNECTION_URL,
} from './rabbitmq-connection-url.provider.js';

@Module({
  providers: [amqpConnectionProvider, rabbitMqConnectionUrlProvider],
  exports: [AMQP_CONNECT, RABBITMQ_CONNECTION_URL],
})
export class MessagingModule {}
