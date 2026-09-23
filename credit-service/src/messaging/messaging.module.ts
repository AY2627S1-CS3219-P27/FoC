import { Module } from '@nestjs/common';
import { amqpConnectionProvider } from './amqp-connection.provider.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';


@Module({
  providers: [amqpConnectionProvider, RabbitMqConsumerTransport],
  exports: [RabbitMqConsumerTransport],
})
export class MessagingModule {}
