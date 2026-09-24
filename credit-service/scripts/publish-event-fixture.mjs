import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from 'amqplib';
import 'dotenv/config';

const fixturePath = resolve(
  process.cwd(),
  process.argv[2] ?? 'test/fixtures/user-registered.v1.json',
);
const rabbitMqUrl = process.env.RABBITMQ_URL;
const exchange = process.env.RABBITMQ_EXCHANGE ?? 'foc.events';
const routingKey =
  process.env.RABBITMQ_USER_REGISTERED_ROUTING_KEY ?? 'user.registered.v1';

if (!rabbitMqUrl) {
  throw new Error('RABBITMQ_URL is required');
}

const body = await readFile(fixturePath);
const event = JSON.parse(body.toString('utf8'));
const connection = await connect(rabbitMqUrl);
const channel = await connection.createConfirmChannel();

try {
  // Shared broker infrastructure owns the domain exchange. Publishing tools
  // verify it exists without acquiring permission to configure it.
  await channel.checkExchange(exchange);
  let writable = true;
  const confirmed = new Promise((resolveConfirmation, rejectConfirmation) => {
    writable = channel.publish(
      exchange,
      routingKey,
      body,
      {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        type: event.eventType,
        appId: event.publisher,
      },
      (error) =>
        error ? rejectConfirmation(error) : resolveConfirmation(undefined),
    );
  });
  await Promise.all([
    confirmed,
    writable ? Promise.resolve() : once(channel, 'drain'),
  ]);
  console.log(
    `Published ${event.eventType} ${event.eventId} to ${exchange}:${routingKey}`,
  );
} finally {
  await channel.close().catch(() => undefined);
  await connection.close().catch(() => undefined);
}
