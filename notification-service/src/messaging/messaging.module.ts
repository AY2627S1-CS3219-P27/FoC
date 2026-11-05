import { Module } from '@nestjs/common';
import { rabbitMqConnectionUrlProvider } from './rabbitmq-connection-url.provider.js';

@Module({
  providers: [rabbitMqConnectionUrlProvider],
  exports: [rabbitMqConnectionUrlProvider],
})
export class MessagingModule {}
