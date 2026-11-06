import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import {
  CREDIT_SETTLEMENT_QUEUE,
  CreditSettlementConsumerLifecycle,
} from './credit-settlement-consumer.lifecycle.js';
import type { CreditSettlementMessageHandler } from './credit-settlement-message.handler.js';

describe('CreditSettlementConsumerLifecycle', () => {
  it('attaches the canonical settlement subscription', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as CreditSettlementMessageHandler;
    const transport = {
      subscribe,
    } as unknown as RabbitMqConsumerTransport;

    await new CreditSettlementConsumerLifecycle(
      transport,
      handler,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: CREDIT_SETTLEMENT_QUEUE,
      routingKey: 'credit.settlement.v1',
      handler,
    });
  });
});
