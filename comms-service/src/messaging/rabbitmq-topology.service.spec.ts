import type { Channel } from 'amqplib';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_LIFECYCLE_STREAMS,
  COMMS_RETRY_DELAYS_MS,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from './rabbitmq-topology.js';
import { RabbitMqTopologyService } from './rabbitmq-topology.service.js';

function harness() {
  const channel = {
    assertExchange: vi.fn().mockResolvedValue({ exchange: '' }),
    assertQueue: vi
      .fn()
      .mockResolvedValue({ queue: '', messageCount: 0, consumerCount: 0 }),
    bindQueue: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createChannel: vi.fn().mockResolvedValue(channel as unknown as Channel),
  };
  const service = new RabbitMqTopologyService(
    connection as unknown as RabbitMqConnectionService,
  );
  return { channel, connection, service };
}

describe('RabbitMqTopologyService', () => {
  it('declares the three durable direct service exchanges', async () => {
    const { channel, service } = harness();
    await service.provision();

    expect(channel.assertExchange.mock.calls).toEqual(
      [
        COMMS_RETRY_EXCHANGE,
        COMMS_RETRY_RETURN_EXCHANGE,
        COMMS_DEAD_LETTER_EXCHANGE,
      ].map((exchange) => [exchange, 'direct', { durable: true }]),
    );
  });

  it('creates every retry chain, return binding, and DLQ without declaring a primary', async () => {
    const { channel, service } = harness();
    await service.provision();

    expect(channel.assertQueue).toHaveBeenCalledTimes(
      COMMS_LIFECYCLE_STREAMS.length * (COMMS_RETRY_DELAYS_MS.length + 1),
    );
    for (const { queue } of COMMS_LIFECYCLE_STREAMS) {
      expect(channel.assertQueue).not.toHaveBeenCalledWith(
        queue,
        expect.anything(),
      );
      expect(channel.bindQueue).toHaveBeenCalledWith(
        queue,
        COMMS_RETRY_RETURN_EXCHANGE,
        queue,
      );

      COMMS_RETRY_DELAYS_MS.forEach((delay, index) => {
        const retryQueue = `${queue}.retry.${index + 1}`;
        expect(channel.assertQueue).toHaveBeenCalledWith(retryQueue, {
          durable: true,
          messageTtl: delay,
          deadLetterExchange: COMMS_RETRY_RETURN_EXCHANGE,
          deadLetterRoutingKey: queue,
        });
        expect(channel.bindQueue).toHaveBeenCalledWith(
          retryQueue,
          COMMS_RETRY_EXCHANGE,
          retryQueue,
        );
      });

      const deadLetterQueue = `${queue}.dlq`;
      expect(channel.assertQueue).toHaveBeenCalledWith(deadLetterQueue, {
        durable: true,
      });
      expect(channel.bindQueue).toHaveBeenCalledWith(
        deadLetterQueue,
        COMMS_DEAD_LETTER_EXCHANGE,
        deadLetterQueue,
      );
    }

    const calls = JSON.stringify([
      ...channel.assertExchange.mock.calls,
      ...channel.assertQueue.mock.calls,
      ...channel.bindQueue.mock.calls,
    ]);
    expect(calls).not.toContain(COMMS_DOMAIN_EXCHANGE);
    expect(calls).not.toContain('x-max-length');
    expect(calls).not.toContain('x-max-length-bytes');
    expect(calls).not.toContain('overflow');
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('is idempotent when provisioned repeatedly', async () => {
    const { channel, connection, service } = harness();
    await service.provision();
    await service.provision();

    expect(connection.createChannel).toHaveBeenCalledTimes(2);
    expect(channel.assertExchange).toHaveBeenCalledTimes(6);
    expect(channel.close).toHaveBeenCalledTimes(2);
  });

  it('closes its channel and fails startup when a primary queue is absent', async () => {
    const { channel, service } = harness();
    const missingQueue = COMMS_LIFECYCLE_STREAMS[0].queue;
    channel.bindQueue.mockImplementation(
      async (queue: string, exchange: string) => {
        if (
          queue === missingQueue &&
          exchange === COMMS_RETRY_RETURN_EXCHANGE
        ) {
          throw new Error('NOT_FOUND - no queue');
        }
        return {};
      },
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      'NOT_FOUND - no queue',
    );
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
