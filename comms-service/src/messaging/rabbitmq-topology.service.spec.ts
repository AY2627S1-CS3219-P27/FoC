import type { Channel } from 'amqplib';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_EVENTS_BINDING_KEY,
  COMMS_EVENTS_QUEUE,
  COMMS_PUBSUB_EXCHANGE,
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

  it('creates the unified primary, retry chain, return binding, and DLQ', async () => {
    const { channel, service } = harness();
    await service.provision();

    expect(channel.assertQueue).toHaveBeenCalledTimes(
      COMMS_RETRY_DELAYS_MS.length + 2,
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(COMMS_EVENTS_QUEUE, {
      durable: true,
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      COMMS_EVENTS_QUEUE,
      COMMS_PUBSUB_EXCHANGE,
      COMMS_EVENTS_BINDING_KEY,
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      COMMS_EVENTS_QUEUE,
      COMMS_RETRY_RETURN_EXCHANGE,
      COMMS_EVENTS_QUEUE,
    );

    COMMS_RETRY_DELAYS_MS.forEach((delay, index) => {
      const retryQueue = `${COMMS_EVENTS_QUEUE}.retry.${index + 1}`;
      expect(channel.assertQueue).toHaveBeenCalledWith(retryQueue, {
        durable: true,
        messageTtl: delay,
        deadLetterExchange: COMMS_RETRY_RETURN_EXCHANGE,
        deadLetterRoutingKey: COMMS_EVENTS_QUEUE,
      });
      expect(channel.bindQueue).toHaveBeenCalledWith(
        retryQueue,
        COMMS_RETRY_EXCHANGE,
        retryQueue,
      );
    });

    const deadLetterQueue = `${COMMS_EVENTS_QUEUE}.dlq`;
    expect(channel.assertQueue).toHaveBeenCalledWith(deadLetterQueue, {
      durable: true,
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      deadLetterQueue,
      COMMS_DEAD_LETTER_EXCHANGE,
      deadLetterQueue,
    );

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

  it('closes its channel and fails startup when the pubsub binding cannot be installed', async () => {
    const { channel, service } = harness();
    channel.bindQueue.mockImplementation(
      async (queue: string, exchange: string) => {
        if (
          queue === COMMS_EVENTS_QUEUE &&
          exchange === COMMS_PUBSUB_EXCHANGE
        ) {
          throw new Error('NOT_FOUND - no exchange');
        }
        return {};
      },
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      'NOT_FOUND - no exchange',
    );
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
