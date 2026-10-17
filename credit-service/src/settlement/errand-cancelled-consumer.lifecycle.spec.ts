import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { ErrandCancelledConsumerLifecycle } from './errand-cancelled-consumer.lifecycle.js';
import type { ErrandCancelledMessageHandler } from './errand-cancelled-message.handler.js';

describe('ErrandCancelledConsumerLifecycle', () => {
  it('attaches the configured cancellation subscription', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as ErrandCancelledMessageHandler;
    const values = {
      RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE:
        'credit-service.order-errand-cancelled.v1',
      RABBITMQ_ORDER_ERRAND_CANCELLED_ROUTING_KEY: 'order.errand-cancelled.v1',
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    const transport = {
      subscribe,
    } as unknown as RabbitMqConsumerTransport;

    await new ErrandCancelledConsumerLifecycle(
      transport,
      handler,
      config,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: 'credit-service.order-errand-cancelled.v1',
      routingKey: 'order.errand-cancelled.v1',
      handler,
    });
  });
});
