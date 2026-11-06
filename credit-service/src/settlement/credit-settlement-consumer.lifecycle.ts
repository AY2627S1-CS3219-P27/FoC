import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditSettlementMessageHandler } from './credit-settlement-message.handler.js';

@Injectable()
export class CreditSettlementConsumerLifecycle implements OnApplicationBootstrap {
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: CreditSettlementMessageHandler,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: this.config.getOrThrow('RABBITMQ_CREDIT_SETTLEMENT_QUEUE'),
      routingKey: this.config.getOrThrow(
        'RABBITMQ_CREDIT_SETTLEMENT_ROUTING_KEY',
      ),
      handler: this.handler,
    });
  }
}
