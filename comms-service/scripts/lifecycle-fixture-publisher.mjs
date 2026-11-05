import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from 'amqplib';

export const lifecycleFixtureManifest = Object.freeze({
  'errand-accepted': {
    file: 'test/fixtures/errand-accepted.v1.json',
    routingKey: 'order.errand-accepted.v1',
  },
  'errand-reaccepted': {
    file: 'test/fixtures/errand-reaccepted.v1.json',
    routingKey: 'order.errand-accepted.v1',
  },
  'errand-delivered': {
    file: 'test/fixtures/errand-delivered.v1.json',
    routingKey: 'order.errand-delivered.v1',
  },
  'courier-cancelled': {
    file: 'test/fixtures/courier-cancelled.v1.json',
    routingKey: 'order.courier-cancelled.v1',
  },
  'errand-cancelled': {
    file: 'test/fixtures/errand-cancelled.v1.json',
    routingKey: 'order.errand-cancelled.v1',
  },
  'errand-accepted-conflict': {
    file: 'test/fixtures/errand-accepted-conflict.v1.json',
    routingKey: 'order.errand-accepted.v1',
  },
  'errand-accepted-unknown-field': {
    file: 'test/fixtures/errand-accepted-unknown-field.invalid.v1.json',
    routingKey: 'order.errand-accepted.v1',
  },
  'errand-accepted-wrong-publisher': {
    file: 'test/fixtures/errand-accepted-wrong-publisher.invalid.v1.json',
    routingKey: 'order.errand-accepted.v1',
  },
});

export const allowedLifecycleRoutingKeys = new Set(
  Object.values(lifecycleFixtureManifest).map(({ routingKey }) => routingKey),
);

export function resolveFixtureRequest(arguments_, cwd = process.cwd()) {
  const [selection = 'errand-accepted', ...options] = arguments_;
  if (selection === '--list') return { list: true };

  const predefined = lifecycleFixtureManifest[selection];
  if (predefined) {
    if (options.length > 0) {
      throw new Error('Named fixture selectors do not accept extra arguments');
    }
    return {
      fixturePath: resolve(cwd, predefined.file),
      routingKey: predefined.routingKey,
      selection,
    };
  }

  if (
    options.length !== 2 ||
    options[0] !== '--routing-key' ||
    !allowedLifecycleRoutingKeys.has(options[1])
  ) {
    throw new Error(
      'Custom fixture files require --routing-key with an allowed lifecycle route',
    );
  }
  return {
    fixturePath: resolve(cwd, selection),
    routingKey: options[1],
    selection,
  };
}

function safeShortString(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 255
    ? value
    : undefined;
}

export async function publishFixture({
  url,
  exchange = 'foc.events',
  routingKey,
  body,
  connectBroker = connect,
}) {
  if (!url) throw new Error('RABBITMQ_FIXTURE_URL is required');
  if (!allowedLifecycleRoutingKeys.has(routingKey)) {
    throw new Error('Fixture routing key is not allowed');
  }

  let event = {};
  try {
    event = JSON.parse(body.toString('utf8'));
  } catch {
    // Exact invalid bytes may be intentionally published for transport tests.
  }

  const connection = await connectBroker(url);
  const channel = await connection.createConfirmChannel();
  let returned = false;
  const onReturn = () => {
    returned = true;
  };
  channel.on('return', onReturn);
  try {
    await channel.checkExchange(exchange);
    let writable = true;
    const confirmed = new Promise((resolveConfirmation, rejectConfirmation) => {
      writable = channel.publish(
        exchange,
        routingKey,
        body,
        {
          mandatory: true,
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          messageId: safeShortString(event.eventId),
          type: safeShortString(event.eventType),
          appId: safeShortString(event.publisher),
        },
        (error) =>
          error ? rejectConfirmation(error) : resolveConfirmation(undefined),
      );
    });
    await Promise.all([
      confirmed,
      writable ? Promise.resolve() : once(channel, 'drain'),
    ]);
    if (returned) throw new Error('Fixture publication was unroutable');
  } finally {
    channel.off('return', onReturn);
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
  }
}
