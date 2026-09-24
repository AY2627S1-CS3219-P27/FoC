import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import 'dotenv/config';

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const password = (
  await readFile(required('RABBITMQ_PASSWORD_FILE'), 'utf8')
).replace(/[\r\n]+$/, '');
if (!password) {
  throw new Error('RABBITMQ_PASSWORD_FILE must not be empty');
}

const user = required('RABBITMQ_USER');
const host = required('RABBITMQ_HOST');
const port = required('RABBITMQ_PORT');
const vhost = required('RABBITMQ_VHOST');
const url =
  `amqp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@` +
  `${host}:${port}/${encodeURIComponent(vhost)}`;

const connection = await amqp.connect(url);
const queue = `credit-service.permission-test.${randomUUID()}`;

const publishConfirmed = (channel, exchange, routingKey) =>
  new Promise((resolve, reject) => {
    channel.publish(
      exchange,
      routingKey,
      Buffer.from('{}'),
      { persistent: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });

const expectDenied = async (description, action) => {
  const channel = await connection.createConfirmChannel();
  // Permission failures close only this channel. Consume the error event so
  // the expected broker denial cannot become an unhandled process error.
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

  // Root owns foc.events; Credit Service may only check it and bind the exact
  // inbound key to queues in its own namespace.
  await channel.checkExchange('foc.events');
  await channel.assertExchange('foc.credit.retry', 'direct', { durable: true });
  await channel.assertExchange('foc.credit.back', 'direct', { durable: true });
  await channel.assertExchange('foc.credit.dlx', 'direct', { durable: true });
  await channel.assertQueue(queue, {
    durable: false,
    autoDelete: true,
    exclusive: true,
  });
  await channel.bindQueue(queue, 'foc.events', 'user.registered.v1');

  const { consumerTag } = await channel.consume(queue, () => undefined, {
    noAck: false,
  });
  await channel.cancel(consumerTag);

  await publishConfirmed(
    channel,
    'foc.events',
    'credit.account-initialised.v1',
  );
  await publishConfirmed(channel, 'foc.credit.retry', queue);
  await publishConfirmed(channel, 'foc.credit.dlx', `${queue}.dlq`);
  await channel.deleteQueue(queue);
  await channel.close();

  await expectDenied('configure foc.events', (candidate) =>
    candidate.assertExchange('foc.events', 'topic', { durable: true }),
  );
  await expectDenied('declare an Email Service queue', (candidate) =>
    candidate.assertQueue(`email-service.permission-test.${randomUUID()}`),
  );
  await expectDenied('consume the Email Service queue', (candidate) =>
    candidate.consume('otp_emails', () => undefined),
  );
  await expectDenied('bind an unauthorized domain key', async (candidate) => {
    const candidateQueue = `credit-service.permission-test.${randomUUID()}`;
    await candidate.assertQueue(candidateQueue, {
      durable: false,
      autoDelete: true,
      exclusive: true,
    });
    await candidate.bindQueue(candidateQueue, 'foc.events', 'order.created.v1');
  });
  await expectDenied('publish the inbound domain key', (candidate) =>
    publishConfirmed(candidate, 'foc.events', 'user.registered.v1'),
  );
  await expectDenied('publish another domain key', (candidate) =>
    publishConfirmed(candidate, 'foc.events', 'order.created.v1'),
  );
  await expectDenied('publish to Email Service retry resources', (candidate) =>
    publishConfirmed(candidate, 'foc.retry', 'otp.email'),
  );

  console.log('Credit Service RabbitMQ permissions verified');
} finally {
  // A denied binding can leave its temporary queue behind until this
  // connection closes; every test queue is auto-delete and connection-scoped.
  await connection.close().catch(() => undefined);
}
