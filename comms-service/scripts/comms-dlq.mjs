import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import {
  AccountEventContractValidator,
  eventRegistry,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import 'dotenv/config';

const EVENTS_DLQ = 'comms-service.events.dlq';
const SUPPORTED_ROUTES = new Set([
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
]);
const TRACE_HEADERS = new Set(['traceparent', 'tracestate']);

const usage = () => `Usage:
  node scripts/comms-dlq.mjs inspect --queue <known-dlq>
  node scripts/comms-dlq.mjs redrive --queue <known-dlq> \\
    --corrected-file <json-file> --confirm-event-id <uuid>

inspect reserves one message, prints evidence, then requeues it unchanged.
redrive validates corrected JSON, publishes it through foc.events using the
normal domain routing key, waits for confirmation, then acknowledges the DLQ
copy. IDENTITY_CONFLICT deliveries cannot be redriven by this tool.`;

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [action, ...rest] = argv;
  if (!['inspect', 'redrive'].includes(action)) throw new Error(usage());
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid argument near ${name ?? '<end>'}\n${usage()}`);
    }
    options[name.slice(2)] = value;
  }
  if (options.queue !== EVENTS_DLQ) throw new Error('Unknown DLQ queue');
  if (
    action === 'redrive' &&
    (!options['corrected-file'] || !options['confirm-event-id'])
  ) {
    throw new Error('redrive requires --corrected-file and --confirm-event-id');
  }
  return { action, options };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function brokerUrl() {
  const password = (
    await readFile(required('RABBITMQ_OPERATOR_PASSWORD_FILE'), 'utf8')
  ).replace(/[\r\n]+$/, '');
  if (!password) throw new Error('RABBITMQ_OPERATOR_PASSWORD_FILE is empty');
  return (
    `amqp://${encodeURIComponent(required('RABBITMQ_OPERATOR_USER'))}:` +
    `${encodeURIComponent(password)}@${required('RABBITMQ_OPERATOR_HOST')}:` +
    `${required('RABBITMQ_OPERATOR_PORT')}/` +
    encodeURIComponent(required('RABBITMQ_OPERATOR_VHOST'))
  );
}

function headerString(message, name) {
  const value = message.properties.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

function sourceEventId(message) {
  const fromHeader = headerString(message, 'x-event-id');
  if (fromHeader) return fromHeader;
  if (typeof message.properties.messageId === 'string') {
    return message.properties.messageId;
  }
  try {
    const body = JSON.parse(message.content.toString('utf8'));
    return typeof body?.eventId === 'string' ? body.eventId : undefined;
  } catch {
    return undefined;
  }
}

function originalRoutingKey(message) {
  const value = headerString(message, 'x-comms-original-routing-key');
  return value && SUPPORTED_ROUTES.has(value) ? value : undefined;
}

function inspectEvidence(message, queue, routingKey) {
  return {
    queue,
    normalRoutingKey: routingKey ?? null,
    eventId: sourceEventId(message) ?? null,
    failureCategory: headerString(message, 'x-failure-category') ?? 'UNKNOWN',
    failureReason: headerString(message, 'x-failure-reason') ?? null,
    failureTimestamp: headerString(message, 'x-failure-timestamp') ?? null,
    retryCount: message.properties.headers?.['x-retry-count'] ?? null,
    bodyUtf8: message.content.toString('utf8'),
  };
}

function safePublishHeaders(message) {
  return Object.fromEntries(
    Object.entries(message.properties.headers ?? {}).filter(
      ([name, value]) =>
        TRACE_HEADERS.has(name.toLowerCase()) && typeof value === 'string',
    ),
  );
}

async function publishCorrected(channel, message, routingKey, corrected) {
  let returned = false;
  const correlationId = `comms-dlq-redrive-${corrected.eventId}`;
  const onReturn = (returnedMessage) => {
    if (returnedMessage.properties.correlationId === correlationId) {
      returned = true;
    }
  };
  channel.on('return', onReturn);
  try {
    await new Promise((resolve, reject) => {
      channel.publish(
        'foc.events',
        routingKey,
        Buffer.from(JSON.stringify(corrected), 'utf8'),
        {
          mandatory: true,
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          messageId: corrected.eventId,
          correlationId,
          type: corrected.eventType,
          appId: 'comms-dlq-operator',
          timestamp: Date.now(),
          headers: safePublishHeaders(message),
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    if (returned) throw new Error('Corrected message was unroutable');
  } finally {
    channel.off('return', onReturn);
  }
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed.help) {
  console.log(usage());
  process.exit(0);
}

const { action, options } = parsed;
const queue = options.queue;
const connection = await amqp.connect(await brokerUrl());
const channel = await connection.createConfirmChannel();
let delivery;

try {
  await channel.checkQueue(queue);
  delivery = await channel.get(queue, { noAck: false });
  if (delivery === false) {
    console.log(`DLQ ${queue} is empty`);
    process.exitCode = 2;
  } else if (action === 'inspect') {
    const routingKey = originalRoutingKey(delivery);
    console.log(
      JSON.stringify(inspectEvidence(delivery, queue, routingKey), null, 2),
    );
    channel.nack(delivery, false, true);
    delivery = undefined;
  } else {
    const routingKey = originalRoutingKey(delivery);
    if (!routingKey) {
      throw new Error('DLQ message has no supported original routing key');
    }
    const expectedEventId = options['confirm-event-id'];
    if (sourceEventId(delivery) !== expectedEventId) {
      throw new Error(
        'The reserved DLQ message does not match --confirm-event-id',
      );
    }
    if (headerString(delivery, 'x-failure-category') === 'IDENTITY_CONFLICT') {
      throw new Error(
        'IDENTITY_CONFLICT requires upstream investigation; automatic redrive is unsafe',
      );
    }
    const corrected = JSON.parse(
      await readFile(options['corrected-file'], 'utf8'),
    );
    if (corrected?.eventId !== expectedEventId) {
      throw new Error('Corrected eventId must match --confirm-event-id');
    }
    const contract = eventRegistry[routingKey];
    if (!contract) throw new Error('No shared contract exists for the route');
    const validation = new AccountEventContractValidator().validate(
      routingKey,
      corrected,
    );
    if (!validation.valid) {
      throw new Error(`Corrected event fails ${validation.code}`);
    }

    await publishCorrected(channel, delivery, routingKey, validation.value);
    channel.ack(delivery);
    delivery = undefined;
    console.log(
      `Redrove ${expectedEventId} through foc.events with ${routingKey}; DLQ copy acknowledged`,
    );
  }
} finally {
  if (delivery) channel.nack(delivery, false, true);
  await channel.close().catch(() => undefined);
  await connection.close().catch(() => undefined);
}
