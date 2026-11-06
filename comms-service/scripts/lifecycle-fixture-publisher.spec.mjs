import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import {
  allowedLifecycleRoutingKeys,
  lifecycleFixtureManifest,
  publishFixture,
  resolveFixtureRequest,
} from './lifecycle-fixture-publisher.mjs';

describe('lifecycle fixture publisher', () => {
  it('lists an allowlisted route for every named fixture', () => {
    expect(Object.keys(lifecycleFixtureManifest)).toHaveLength(8);
    expect(
      Object.values(lifecycleFixtureManifest).every(({ routingKey }) =>
        allowedLifecycleRoutingKeys.has(routingKey),
      ),
    ).toBe(true);
  });

  it('resolves named fixtures without trusting their content', () => {
    expect(resolveFixtureRequest(['errand-accepted'], 'C:/repo')).toEqual({
      fixturePath: resolve('C:/repo', 'test/fixtures/errand-accepted.v1.json'),
      routingKey: 'order.errand-accepted.v1',
      selection: 'errand-accepted',
    });
  });

  it('requires an explicit allowlisted route for custom files', () => {
    expect(() => resolveFixtureRequest(['custom.json'])).toThrow(
      /require --routing-key/,
    );
    expect(() =>
      resolveFixtureRequest([
        'custom.json',
        '--routing-key',
        'credit.reservation.v1',
      ]),
    ).toThrow(/allowed lifecycle route/);
  });

  function broker({ confirmationError, returned = false } = {}) {
    const channel = new EventEmitter();
    Object.assign(channel, {
      checkExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn((exchange, route, body, options, callback) => {
        if (returned) channel.emit('return', { fields: {} });
        callback(confirmationError);
        return true;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const connection = {
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return { channel, connection, connectBroker: vi.fn(() => connection) };
  }

  it('publishes persistent mandatory bytes and waits for confirmation', async () => {
    const fake = broker();
    const body = Buffer.from(
      JSON.stringify({
        eventId: '10000000-0000-4000-8000-000000000001',
        eventType: 'ErrandAccepted',
        publisher: 'order-service',
      }),
    );
    await publishFixture({
      url: 'amqp://fixture',
      routingKey: 'order.errand-accepted.v1',
      body,
      connectBroker: fake.connectBroker,
    });
    expect(fake.channel.publish).toHaveBeenCalledWith(
      'foc.events',
      'order.errand-accepted.v1',
      body,
      expect.objectContaining({ mandatory: true, persistent: true }),
      expect.any(Function),
    );
  });

  it('rejects publisher nacks and unroutable fixtures', async () => {
    await expect(
      publishFixture({
        url: 'amqp://fixture',
        routingKey: 'order.errand-accepted.v1',
        body: Buffer.from('{}'),
        connectBroker: broker({ confirmationError: new Error('nack') })
          .connectBroker,
      }),
    ).rejects.toThrow('nack');
    await expect(
      publishFixture({
        url: 'amqp://fixture',
        routingKey: 'order.errand-accepted.v1',
        body: Buffer.from('{}'),
        connectBroker: broker({ returned: true }).connectBroker,
      }),
    ).rejects.toThrow('unroutable');
  });
});
