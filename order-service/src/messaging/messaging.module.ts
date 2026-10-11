import { Module } from '@nestjs/common';
import {
  AMQP_CONNECT,
  amqpConnectionProvider,
} from './amqp-connection.provider.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';
import {
  rabbitMqConnectionUrlProvider,
  RABBITMQ_CONNECTION_URL,
} from './rabbitmq-connection-url.provider.js';

@Module({
  providers: [
    amqpConnectionProvider,
    rabbitMqConnectionUrlProvider,
    RabbitMqConsumerTransport,
  ],
  exports: [AMQP_CONNECT, RABBITMQ_CONNECTION_URL, RabbitMqConsumerTransport],
})
export class MessagingModule {}
