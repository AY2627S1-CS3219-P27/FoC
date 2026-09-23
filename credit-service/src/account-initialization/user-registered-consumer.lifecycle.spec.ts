import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { UserRegisteredConsumerLifecycle } from './user-registered-consumer.lifecycle.js';
import type { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

describe('UserRegisteredConsumerLifecycle', () => {
  it('attaches the application handler during bootstrap', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const handler = {} as UserRegisteredMessageHandler;
    const values = {
      RABBITMQ_USER_REGISTERED_QUEUE: 'credit-service.user-registered.v1',
      RABBITMQ_USER_REGISTERED_ROUTING_KEY: 'user.registered.v1',
    };
    const lifecycle = new UserRegisteredConsumerLifecycle(
      { subscribe } as unknown as RabbitMqConsumerTransport,
      handler,
      {
        getOrThrow: (key: keyof typeof values) => values[key],
      } as ConfigService<EnvironmentVariables, true>,
    );

    await lifecycle.onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith({
      queue: 'credit-service.user-registered.v1',
      routingKey: 'user.registered.v1',
      handler,
    });
  });
});
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
