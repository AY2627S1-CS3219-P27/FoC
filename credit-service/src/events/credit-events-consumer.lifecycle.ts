import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import {
  CREDIT_EVENT_ROUTING_KEYS,
  CreditEventsMessageHandler,
} from './credit-events-message.handler.js';

/**
 * Subscribes one queue to the fact events Credit Service cares about on the
 * pub/sub exchange. Point-to-point messages keep their own queues.
 */
@Injectable()
export class CreditEventsConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: CreditEventsMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow('RABBITMQ_EVENTS_QUEUE'),
      exchange: this.config.getOrThrow('RABBITMQ_PUBSUB_EXCHANGE'),
      routingKey: CREDIT_EVENT_ROUTING_KEYS,
      handler: this.handler,
    });
  }
}
