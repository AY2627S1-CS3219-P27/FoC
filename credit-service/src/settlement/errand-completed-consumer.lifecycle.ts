import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { ErrandCompletedMessageHandler } from './errand-completed-message.handler.js';

@Injectable()
export class ErrandCompletedConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: ErrandCompletedMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow('RABBITMQ_ORDER_ERRAND_COMPLETED_QUEUE'),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_ORDER_ERRAND_COMPLETED_ROUTING_KEY',
      ),
      handler: this.handler,
    });
  }
}
