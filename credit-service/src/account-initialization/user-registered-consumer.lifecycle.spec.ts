import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { UserRegisteredConsumerLifecycle } from './user-registered-consumer.lifecycle.js';
import type { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

describe('UserRegisteredConsumerLifecycle', () => {
  it('attaches the application handler during bootstrap', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const handler = {} as UserRegisteredMessageHandler;
    const lifecycle = new UserRegisteredConsumerLifecycle(
      { start } as unknown as RabbitMqConsumerTransport,
      handler,
    );

    await lifecycle.onApplicationBootstrap();

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(handler);
  });
});
