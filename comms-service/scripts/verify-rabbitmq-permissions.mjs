import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import 'dotenv/config';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const password = (
  await readFile(required('RABBITMQ_PASSWORD_FILE'), 'utf8')
).replace(/[\r\n]+$/, '');
if (!password) throw new Error('RABBITMQ_PASSWORD_FILE must not be empty');

const url =
  `amqp://${encodeURIComponent(required('RABBITMQ_USER'))}:` +
  `${encodeURIComponent(password)}@${required('RABBITMQ_HOST')}:` +
  `${required('RABBITMQ_PORT')}/${encodeURIComponent(required('RABBITMQ_VHOST'))}`;
const connection = await amqp.connect(url);

const publishPersistent = (channel, exchange, routingKey) =>
  new Promise((resolve, reject) => {
    channel.publish(
      exchange,
      routingKey,
      Buffer.from('{}'),
      { mandatory: false, persistent: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });

const expectDenied = async (description, action) => {
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => undefined);
  try {
    await action(channel);
  } catch {
    console.log(`Denied as expected: ${description}`);
    return;
  } finally {
    await channel.close().catch(() => undefined);
  }
  throw new Error(`Broker unexpectedly allowed: ${description}`);
};

try {
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => undefined);
  const primaryQueues = [
    'comms-service.order-errand-accepted.v1',
    'comms-service.order-errand-delivered.v1',
    'comms-service.order-courier-cancelled.v1',
    'comms-service.order-errand-cancelled.v1',
  ];
  const retryDelays = [1_000, 2_000, 4_000, 8_000, 16_000];

  for (const exchange of [
    'foc.comms.retry',
    'foc.comms.back',
    'foc.comms.dlx',
  ]) {
    await channel.assertExchange(exchange, 'direct', { durable: true });
    await publishPersistent(
      channel,
      exchange,
      `permission-test.${randomUUID()}`,
    );
  }

  // Reading a primary is allowed. Preserve any retained delivery exactly by
  // requeueing it immediately; configuring the primary is tested as denied.
  const retained = await channel.get(primaryQueues[0], { noAck: false });
  if (retained !== false) channel.nack(retained, false, true);

  for (const queue of primaryQueues) {
    await channel.bindQueue(queue, 'foc.comms.back', queue);
    for (const [index, delay] of retryDelays.entries()) {
      const retryQueue = `${queue}.retry.${index + 1}`;
      await channel.assertQueue(retryQueue, {
        durable: true,
        messageTtl: delay,
        deadLetterExchange: 'foc.comms.back',
        deadLetterRoutingKey: queue,
      });
      await channel.bindQueue(retryQueue, 'foc.comms.retry', retryQueue);
    }
    const deadLetterQueue = `${queue}.dlq`;
    await channel.assertQueue(deadLetterQueue, { durable: true });
    await channel.bindQueue(deadLetterQueue, 'foc.comms.dlx', deadLetterQueue);
  }

  await channel.close();

  await expectDenied('configure a primary queue', (candidate) =>
    candidate.assertQueue(primaryQueues[0], { durable: true }),
  );
  await expectDenied('publish to foc.events', (candidate) =>
    publishPersistent(candidate, 'foc.events', 'order.errand-accepted.v1'),
  );
  await expectDenied('configure foc.events', (candidate) =>
    candidate.assertExchange('foc.events', 'direct', { durable: true }),
  );
  await expectDenied('declare another service queue', (candidate) =>
    candidate.assertQueue(`credit-service.permission-test.${randomUUID()}`),
  );
  await expectDenied('consume another service queue', (candidate) =>
    candidate.consume(
      'credit-service.order-errand-cancelled.v1',
      () => undefined,
    ),
  );
  await expectDenied('publish to another service retry exchange', (candidate) =>
    publishPersistent(candidate, 'foc.credit.retry', 'permission-test'),
  );

  console.log('Communication Service RabbitMQ permissions verified');
} finally {
  await connection.close().catch(() => undefined);
}
