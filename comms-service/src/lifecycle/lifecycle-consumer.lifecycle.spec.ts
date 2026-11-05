import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { COMMS_EVENTS_QUEUE } from '../messaging/rabbitmq-topology.js';
import { LifecycleConsumerLifecycle } from './lifecycle-consumer.lifecycle.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

describe('LifecycleConsumerLifecycle', () => {
  it('registers the unified event stream against the durable dispatcher', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const transport = { subscribe } as unknown as RabbitMqConsumerTransport;
    const handler = {} as LifecycleMessageDispatcher;
    const lifecycle = new LifecycleConsumerLifecycle(transport, handler);

    await lifecycle.onApplicationBootstrap();

    expect(subscribe).toHaveBeenCalledWith({
      queue: COMMS_EVENTS_QUEUE,
      handler,
    });
  });
});
