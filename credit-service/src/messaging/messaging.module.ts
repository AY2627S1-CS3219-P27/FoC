import { Module } from '@nestjs/common';
import {
  AMQP_CONNECT,
  amqpConnectionProvider,
} from './amqp-connection.provider.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';

@Module({
  providers: [amqpConnectionProvider, RabbitMqConsumerTransport],
  exports: [AMQP_CONNECT, RabbitMqConsumerTransport],
})
export class MessagingModule {}
