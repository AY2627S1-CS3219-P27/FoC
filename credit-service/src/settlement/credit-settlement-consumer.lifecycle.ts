import { CREDIT_SETTLEMENT_V1_ROUTING_KEY } from '@foc/contracts';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditSettlementMessageHandler } from './credit-settlement-message.handler.js';

export const CREDIT_SETTLEMENT_QUEUE = 'credit-service.credit-settlement.v1';

@Injectable()
export class CreditSettlementConsumerLifecycle
  implements OnApplicationBootstrap
{
  constructor(
    private readonly transport: RabbitMqConsumerTransport,
    private readonly handler: CreditSettlementMessageHandler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.subscribe({
      queue: CREDIT_SETTLEMENT_QUEUE,
      routingKey: CREDIT_SETTLEMENT_V1_ROUTING_KEY,
      handler: this.handler,
    });
  }
}
