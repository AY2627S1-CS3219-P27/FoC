import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

/** 
 * Starts the consumer only after Nest has constructed the complete handler. 
 * */
@Injectable()
export class UserRegisteredConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: UserRegisteredMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow('RABBITMQ_USER_REGISTERED_QUEUE'),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_USER_REGISTERED_ROUTING_KEY',
      ),
      handler: this.handler,
    });
  }
}
