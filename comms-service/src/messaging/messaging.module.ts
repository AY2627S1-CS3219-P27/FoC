import { Module } from '@nestjs/common';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import { rabbitMqConnectionUrlProvider } from './rabbitmq-connection-url.provider.js';
import { RabbitMqTopologyService } from './rabbitmq-topology.service.js';

@Module({
  providers: [
    rabbitMqConnectionUrlProvider,
    RabbitMqConnectionService,
    RabbitMqTopologyService,
  ],
  exports: [RabbitMqConnectionService, RabbitMqTopologyService],
})
export class MessagingModule {}
