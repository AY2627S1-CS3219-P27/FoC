import type { Channel } from 'amqplib';
import { assertTopology, attemptOf, retryDelayFor } from './topology.js';

function channelMock() {
  return {
    checkExchange: vi.fn(async () => undefined),
    assertExchange: vi.fn(async () => undefined),
    assertQueue: vi.fn(async () => undefined),
    bindQueue: vi.fn(async () => undefined),
  };
}

describe('notification broker topology', () => {
  it('asserts the retry, return and dead-letter exchanges', async () => {
    const channel = channelMock();

    await assertTopology(channel as unknown as Channel);

    expect(channel.checkExchange).toHaveBeenCalledWith('foc.events');
    expect(channel.assertExchange).toHaveBeenCalledWith(
      'foc.retry',
      'headers',
      {
        durable: true,
      },
    );
    expect(channel.assertExchange).toHaveBeenCalledWith('foc.back', 'direct', {
      durable: true,
    });
    expect(channel.assertExchange).toHaveBeenCalledWith('foc.dlq', 'direct', {
      durable: true,
    });
  });

  it('binds the intake queue to the fan-out and retry return keys', async () => {
    const channel = channelMock();

    await assertTopology(channel as unknown as Channel);

    expect(channel.bindQueue).toHaveBeenCalledWith(
      'notification-service.notify.v1',
      'foc.events',
      'notification.notify.v1',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'notification-service.notify.v1',
      'foc.back',
      'notification.notify.v1',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'notification-service.notify.v1',
      'foc.back',
      'notification.notify-retry.v1',
    );
  });

  it('creates one parking lot per backoff hop with its TTL and DLX', async () => {
    const channel = channelMock();

    await assertTopology(channel as unknown as Channel);

    for (const delay of [60_000, 120_000, 240_000, 480_000]) {
      const queue = `notify_retry_${delay / 1000}s`;
      expect(channel.assertQueue).toHaveBeenCalledWith(queue, {
        durable: true,
        arguments: {
          'x-queue-type': 'classic',
          'x-dead-letter-exchange': 'foc.back',
          'x-message-ttl': delay,
        },
      });
      expect(channel.bindQueue).toHaveBeenCalledWith(queue, 'foc.retry', '', {
        'x-match': 'all',
        'foc-delay': String(delay),
      });
    }
  });

  it('binds the dead-letter queue for both routes', async () => {
    const channel = channelMock();

    await assertTopology(channel as unknown as Channel);

    expect(channel.bindQueue).toHaveBeenCalledWith(
      'notification-service.notify.v1.dlq',
      'foc.dlq',
      'notification.notify.v1',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'notification-service.notify.v1.dlq',
      'foc.dlq',
      'notification.notify-retry.v1',
    );
  });
});

describe('attemptOf', () => {
  it('defaults a missing header to the first attempt', () => {
    expect(attemptOf(undefined)).toBe(1);
  });

  it('accepts integer attempts in range', () => {
    expect(attemptOf(3)).toBe(3);
    expect(attemptOf('5')).toBe(5);
  });

  it('rejects values that cannot be a delivery attempt', () => {
    expect(attemptOf(0)).toBeUndefined();
    expect(attemptOf(6)).toBeUndefined();
    expect(attemptOf(1.5)).toBeUndefined();
    expect(attemptOf('abc')).toBeUndefined();
  });
});

describe('retryDelayFor', () => {
  it('maps each attempt to its backoff hop', () => {
    expect(retryDelayFor(2)).toBe(60_000);
    expect(retryDelayFor(3)).toBe(120_000);
    expect(retryDelayFor(4)).toBe(240_000);
    expect(retryDelayFor(5)).toBe(480_000);
  });

  it('rejects hops beyond the final attempt', () => {
    expect(() => retryDelayFor(6)).toThrow('No retry hop for attempt 6');
  });
});
