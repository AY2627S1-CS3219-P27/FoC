import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

/** Starts the consumer only after Nest has constructed the complete handler. */
@Injectable()
export class UserRegisteredConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: UserRegisteredMessageHandler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.start(this.handler);
  }
}
