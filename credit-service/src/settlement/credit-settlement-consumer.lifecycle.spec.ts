import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditSettlementConsumerLifecycle } from './credit-settlement-consumer.lifecycle.js';
import type { CreditSettlementMessageHandler } from './credit-settlement-message.handler.js';

describe('CreditSettlementConsumerLifecycle', () => {
  it('attaches the canonical settlement subscription', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as CreditSettlementMessageHandler;
    const transport = {
      subscribe,
    } as unknown as RabbitMqConsumerTransport;
    const values = {
      RABBITMQ_CREDIT_SETTLEMENT_QUEUE: 'credit-service.credit-settlement.v1',
      RABBITMQ_CREDIT_SETTLEMENT_ROUTING_KEY: 'credit.settlement.v1',
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;

    await new CreditSettlementConsumerLifecycle(
      transport,
      handler,
      config,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: 'credit-service.credit-settlement.v1',
      routingKey: 'credit.settlement.v1',
      handler,
    });
  });
});
