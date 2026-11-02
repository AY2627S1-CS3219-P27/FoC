import { Module } from '@nestjs/common';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import { rabbitMqConnectionUrlProvider } from './rabbitmq-connection-url.provider.js';

@Module({
  providers: [rabbitMqConnectionUrlProvider, RabbitMqConnectionService],
  exports: [RabbitMqConnectionService],
})
export class MessagingModule {}
