import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditEventsConsumerLifecycle } from './credit-events-consumer.lifecycle.js';
import type { CreditEventsMessageHandler } from './credit-events-message.handler.js';

describe('CreditEventsConsumerLifecycle', () => {
  it('binds one events queue to the three event keys on foc.pubsub', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as CreditEventsMessageHandler;
    const values = {
      RABBITMQ_EVENTS_QUEUE: 'credit-service.events',
      RABBITMQ_PUBSUB_EXCHANGE: 'foc.pubsub',
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    const transport = { subscribe } as unknown as RabbitMqConsumerTransport;

    await new CreditEventsConsumerLifecycle(
      transport,
      handler,
      config,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: 'credit-service.events',
      exchange: 'foc.pubsub',
      routingKey: [
        'user.registered.v1',
        'order.errand-completed.v1',
        'order.errand-cancelled.v1',
      ],
      handler,
    });
  });
});
