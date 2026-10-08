import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from 'amqplib';
import 'dotenv/config';

const fixtures = {
  'user-registered': 'test/fixtures/user-registered.v1.json',
  'credit-reservation': 'test/fixtures/credit-reservation.v1.json',
  'credit-reservation-invalid':
    'test/fixtures/credit-reservation.invalid.v1.json',
  'credit-reservation-adjustment':
    'test/fixtures/credit-reservation-adjustment.v1.json',
  'credit-reservation-adjustment-invalid':
    'test/fixtures/credit-reservation-adjustment.invalid.v1.json',
};

const routingKeys = {
  UserRegistered: {
    environment: 'RABBITMQ_USER_REGISTERED_ROUTING_KEY',
    fallback: 'user.registered.v1',
  },
  CreditReservation: {
    environment: 'RABBITMQ_CREDIT_RESERVATION_ROUTING_KEY',
    fallback: 'credit.reservation.v1',
  },
  CreditReservationAdjustment: {
    environment: 'RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_ROUTING_KEY',
    fallback: 'credit.reservation-adjustment.v1',
  },
};

const selection = process.argv[2] ?? 'user-registered';
if (selection === '--list') {
  console.log(Object.keys(fixtures).join('\n'));
  process.exit(0);
}

const fixturePath = resolve(process.cwd(), fixtures[selection] ?? selection);
const rabbitMqUrl = process.env.RABBITMQ_URL;
const exchange = process.env.RABBITMQ_EXCHANGE ?? 'foc.events';

if (!rabbitMqUrl) {
  throw new Error('RABBITMQ_URL is required');
}

const body = await readFile(fixturePath);
const event = JSON.parse(body.toString('utf8'));
const route = routingKeys[event.eventType];
if (!route) {
  throw new Error(
    `No routing key is configured for ${String(event.eventType)}`,
  );
}
const routingKey = process.env[route.environment] ?? route.fallback;
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
