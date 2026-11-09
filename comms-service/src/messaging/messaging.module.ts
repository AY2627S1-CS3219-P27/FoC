import { Module } from '@nestjs/common';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import { RabbitMqConsumerTransport } from './rabbitmq-consumer.transport.js';
import { rabbitMqConnectionUrlProvider } from './rabbitmq-connection-url.provider.js';
import { RabbitMqTopologyService } from './rabbitmq-topology.service.js';

@Module({
  providers: [
    rabbitMqConnectionUrlProvider,
    RabbitMqConnectionService,
    RabbitMqConsumerTransport,
    RabbitMqTopologyService,
  ],
  exports: [
    RabbitMqConnectionService,
    RabbitMqConsumerTransport,
    RabbitMqTopologyService,
  ],
})
export class MessagingModule {}
