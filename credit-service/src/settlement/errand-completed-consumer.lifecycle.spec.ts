import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { ErrandCompletedConsumerLifecycle } from './errand-completed-consumer.lifecycle.js';
import type { ErrandCompletedMessageHandler } from './errand-completed-message.handler.js';

describe('ErrandCompletedConsumerLifecycle', () => {
  it('attaches the configured completion subscription', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as ErrandCompletedMessageHandler;
    const values = {
      RABBITMQ_ORDER_ERRAND_COMPLETED_QUEUE:
        'credit-service.order-errand-completed.v1',
      RABBITMQ_ORDER_ERRAND_COMPLETED_ROUTING_KEY: 'order.errand-completed.v1',
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    const transport = {
      subscribe,
    } as unknown as RabbitMqConsumerTransport;

    await new ErrandCompletedConsumerLifecycle(
      transport,
      handler,
      config,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: 'credit-service.order-errand-completed.v1',
      routingKey: 'order.errand-completed.v1',
      handler,
    });
  });
});
