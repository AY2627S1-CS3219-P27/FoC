import { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { COMMS_LIFECYCLE_STREAMS } from '../messaging/rabbitmq-topology.js';
import { LifecycleConsumerLifecycle } from './lifecycle-consumer.lifecycle.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

describe('LifecycleConsumerLifecycle', () => {
  it('registers all four streams against the durable dispatcher', async () => {
    const subscribeAll = vi.fn().mockResolvedValue(undefined);
    const transport = { subscribeAll } as unknown as RabbitMqConsumerTransport;
    const handler = {} as LifecycleMessageDispatcher;
    const lifecycle = new LifecycleConsumerLifecycle(transport, handler);

    await lifecycle.onApplicationBootstrap();

    expect(subscribeAll).toHaveBeenCalledWith(
      COMMS_LIFECYCLE_STREAMS.map((stream) => ({ ...stream, handler })),
    );
  });
});
