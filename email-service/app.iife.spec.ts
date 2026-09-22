import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ConsumeMessage } from 'amqplib';

/**
 * The broker wiring lives in a top-level IIFE inside `app.ts`, so it runs the
 * moment the module is imported and cannot be invoked directly. These mocks
 * capture the `consume` callback the IIFE registers, letting us drive the
 * dispatch logic (ack/nack/republish) exactly as RabbitMQ would.
 *
 * Startup-time wiring is snapshotted once in `beforeAll`; per-message mocks
 * are reset explicitly in `beforeEach`.
 */
const mocks = vi.hoisted(() => {
  const readFileSync = vi.fn();
  const sendMail = vi.fn();

  const connect = vi.fn();
  const createChannel = vi.fn();
  const connectionOn = vi.fn();
  const channelOn = vi.fn();
  const assertExchange = vi.fn();
  const assertQueue = vi.fn();
  const bindQueue = vi.fn();
  const consume = vi.fn();
  const ack = vi.fn();
  const nack = vi.fn();
  const publish = vi.fn();
  const redisSet = vi.fn();
  const redisDel = vi.fn();
  const redisOn = vi.fn();

  const redis = { set: redisSet, del: redisDel, on: redisOn };

  const channel = {
    on: channelOn,
    assertExchange,
    assertQueue,
    bindQueue,
    consume,
    ack,
    nack,
    publish,
  };
  const connection = { on: connectionOn, createChannel };

  return {
    readFileSync,
    sendMail,
    connect,
    createChannel,
    connectionOn,
    channelOn,
    assertExchange,
    assertQueue,
    bindQueue,
    consume,
    ack,
    nack,
    publish,
    channel,
    connection,
    redis,
    redisSet,
    redisDel,
    redisOn,
  };
});

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: mocks.readFileSync,
}));

vi.mock('amqplib', () => ({
  default: { connect: mocks.connect },
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
  createTransport: () => ({ sendMail: mocks.sendMail }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function () {
    return mocks.redis;
  }),
}));

type Handler = (msg: ConsumeMessage | null) => Promise<void>;
type UnknownFn = (...args: unknown[]) => void;

let handler: Handler;
let ATTEMPT_HEADER: typeof import('./app.ts').ATTEMPT_HEADER;
let RETRY_EXCHANGE: typeof import('./app.ts').RETRY_EXCHANGE;
let DLQ_EXCHANGE: typeof import('./app.ts').DLQ_EXCHANGE;
let OTP_QUEUE: typeof import('./app.ts').OTP_QUEUE;
let OTP_EMAIL_ROUTING_KEY: typeof import('./app.ts').OTP_EMAIL_ROUTING_KEY;
let loggerError: MockInstance;
let loggerInfo: MockInstance;

/** Startup-side calls, snapshotted before `clearMocks` can wipe them. */
let wiring: {
  brokerUrl: unknown;
  connectCalls: unknown[][];
  createChannelCount: number;
  assertExchangeCalls: unknown[][];
  assertQueueCalls: unknown[][];
  bindQueueCalls: unknown[][];
  consumeQueue: unknown;
  connectionEvents: string[];
  channelEvents: string[];
  connectionHandlers: UnknownFn[];
  channelHandlers: UnknownFn[];
};

const UUID_A = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';
const UUID_B = '7d1f9e0a-2c5b-4d8e-a9f0-4b5c6d7e8f90';

/** Build a broker-enveloped OTP email message (`{ data: {...} }`). */
function otpMessageBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        messageId: UUID_A,
        recipient: 'student@example.com',
        otp: 'abc123',
        subject: 'Your OTP is here',
        expiry: 10,
        ...overrides,
      },
    }),
  );
}

/** Minimal `ConsumeMessage` stand-in carrying content and headers. */
function fakeMessage(
  content: Buffer,
  headers?: Record<string, unknown>,
): ConsumeMessage {
  return {
    content,
    properties: { headers },
    fields: {},
  } as unknown as ConsumeMessage;
}

beforeAll(async () => {
  process.env.SMTP_HOST = 'localhost';
  process.env.SMTP_PORT = '2525';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'test';
  process.env.SMTP_PASS_FILE = '/run/secrets/smtp_password';
  process.env.SMTP_FROM_EMAIL = 'test@foc.com';
  process.env.LOG_LEVEL = 'error';
  process.env.RABBITMQ_USER = 'email-service';
  process.env.RABBITMQ_HOST = 'rabbitmq';
  process.env.RABBITMQ_PORT = '5672';
  process.env.RABBITMQ_VHOST = '/foc';
  process.env.RABBITMQ_PASSWORD_FILE = '/run/secrets/rabbitmq_password';
  process.env.REDIS_HOST = 'redis';
  process.env.REDIS_PORT = '6379';
  process.env.REDIS_USERNAME = 'default';
  process.env.REDIS_DB_INDEX = '0';

  // Distinct secrets per file so the broker-URL assertion pins the rabbitmq one
  // and the special characters exercise URL encoding.
  mocks.readFileSync.mockImplementation((path: string) =>
    path.includes('smtp') ? 'smtp-pass\n' : 'p@ss/word\n',
  );
  mocks.connect.mockResolvedValue(mocks.connection);
  mocks.createChannel.mockResolvedValue(mocks.channel);
  mocks.assertExchange.mockResolvedValue(undefined);
  mocks.assertQueue.mockResolvedValue(undefined);
  mocks.bindQueue.mockResolvedValue(undefined);

  const app = await import('./app.ts');
  ATTEMPT_HEADER = app.ATTEMPT_HEADER;
  RETRY_EXCHANGE = app.RETRY_EXCHANGE;
  DLQ_EXCHANGE = app.DLQ_EXCHANGE;
  OTP_QUEUE = app.OTP_QUEUE;
  OTP_EMAIL_ROUTING_KEY = app.OTP_EMAIL_ROUTING_KEY;

  const { logger } = await import('./logger.ts');
  logger.level = 'silent';
  loggerError = vi.spyOn(logger, 'error');
  loggerInfo = vi.spyOn(logger, 'info');

  // The IIFE awaits connect/createChannel/assertExchange/assertQueue before
  // consuming; give those microtasks time to settle, then capture the handler
  // and snapshot the wiring calls before `clearMocks` wipes them.
  await vi.waitFor(() => expect(mocks.consume).toHaveBeenCalledTimes(1));
  handler = mocks.consume.mock.calls[0][1] as Handler;
  wiring = {
    brokerUrl: mocks.connect.mock.calls[0]?.[0],
    connectCalls: mocks.connect.mock.calls.splice(0),
    createChannelCount: mocks.createChannel.mock.calls.length,
    assertExchangeCalls: mocks.assertExchange.mock.calls.splice(0),
    assertQueueCalls: mocks.assertQueue.mock.calls.splice(0),
    bindQueueCalls: mocks.bindQueue.mock.calls.splice(0),
    consumeQueue: mocks.consume.mock.calls[0]?.[0],
    connectionEvents: mocks.connectionOn.mock.calls.map((c) => c[0] as string),
    channelEvents: mocks.channelOn.mock.calls.map((c) => c[0] as string),
    connectionHandlers: mocks.connectionOn.mock.calls.map(
      (c) => c[1] as UnknownFn,
    ),
    channelHandlers: mocks.channelOn.mock.calls.map((c) => c[1] as UnknownFn),
  };
});

beforeEach(() => {
  mocks.redisSet.mockReset();
  mocks.redisDel.mockReset();
  // Default: the dedup store is up and the id was not seen before.
  mocks.redisSet.mockResolvedValue('OK');
  mocks.redisDel.mockResolvedValue(1);
  mocks.ack.mockReset();
  mocks.nack.mockReset();
  mocks.publish.mockReset();
  // Default: publish succeeds (returns true), so the boolean check passes.
  mocks.publish.mockReturnValue(true);
  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue({ messageId: 'test-id' });
  loggerError.mockClear();
  loggerInfo.mockClear();
});

describe('startup IIFE', () => {
  it('connects to the broker with URL-encoded credentials', () => {
    expect(wiring.connectCalls).toHaveLength(1);
    expect(wiring.brokerUrl).toBe(
      'amqp://email-service:p%40ss%2Fword@rabbitmq:5672/%2Ffoc',
    );
  });

  it('asserts the retry/DLQ exchanges on the channel', () => {
    expect(wiring.createChannelCount).toBe(1);
    expect(wiring.assertExchangeCalls).toEqual([
      ['foc.retry', 'direct', { durable: true }],
      ['foc.dlq', 'direct', { durable: true }],
      ['foc.back', 'direct', { durable: true }],
    ]);
  });

  it('asserts the otp, retry and DLQ queues', () => {
    expect(wiring.assertQueueCalls).toEqual([
      ['otp_emails', { durable: true, arguments: { 'x-queue-type': 'classic' } }],
      [
        'otp_emails.retry',
        {
          durable: true,
          arguments: {
            'x-queue-type': 'classic',
            'x-dead-letter-exchange': 'foc.back',
            'x-message-ttl': 480_000,
          },
        },
      ],
      ['otp_emails.dlq', { durable: true, arguments: { 'x-queue-type': 'classic' } }],
    ]);
  });

  it('consumes the otp_emails queue with a handler', () => {
    expect(wiring.consumeQueue).toBe(OTP_QUEUE);
  });

  it('binds the service-owned routes', () => {
    expect(wiring.bindQueueCalls).toEqual([
      ['otp_emails.retry', 'foc.retry', 'otp.email'],
      ['otp_emails.dlq', 'foc.dlq', 'otp.email'],
      ['otp_emails', 'foc.back', 'otp.email'],
    ]);
  });

  it('registers error and handler-error listeners on the connection and channel', () => {
    expect(wiring.connectionEvents).toEqual(['error', 'handler-error']);
    expect(wiring.channelEvents).toEqual(['error', 'handler-error']);
    expect(wiring.connectionHandlers).toHaveLength(2);
    expect(wiring.channelHandlers).toHaveLength(2);
  });

  it('logs uncaught connection and channel errors', () => {
    for (const fn of wiring.connectionHandlers) {
      fn(new Error('connection boom'), 'error');
    }
    for (const fn of wiring.channelHandlers) {
      fn(new Error('channel boom'), 'error');
    }

    expect(loggerError).toHaveBeenCalledTimes(4);
  });
});

describe('consume handler dispatch', () => {
  it('acks a successfully delivered OTP email', async () => {
    const msg = fakeMessage(otpMessageBody());

    await handler(msg);

    expect(mocks.ack).toHaveBeenCalledWith(msg);
    expect(mocks.nack).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it('drops a malformed message without requeue', async () => {
    const msg = fakeMessage(Buffer.from('not json'));

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('drops a message that fails schema validation', async () => {
    const msg = fakeMessage(otpMessageBody({ messageId: 'not-a-uuid' }));

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('republishes with the next attempt and backoff TTL on send failure', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const body = otpMessageBody();
    const msg = fakeMessage(body, { 'x-trace': 'abc', [ATTEMPT_HEADER]: 1 });

    await handler(msg);

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      OTP_EMAIL_ROUTING_KEY,
      body,
      {
        headers: { 'x-trace': 'abc', [ATTEMPT_HEADER]: 2 },
        expiration: '60000',
        persistent: true,
      },
    );
    expect(mocks.ack).toHaveBeenCalledWith(msg);
    expect(mocks.nack).not.toHaveBeenCalled();
  });

  it('treats a missing attempt header as the first attempt', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const body = otpMessageBody();
    const msg = fakeMessage(body, { 'x-trace': 'abc' });

    await handler(msg);

    expect(mocks.publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      OTP_EMAIL_ROUTING_KEY,
      body,
      {
        headers: { 'x-trace': 'abc', [ATTEMPT_HEADER]: 2 },
        expiration: '60000',
        persistent: true,
      },
    );
  });

  it('dead-letters after the final attempt', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const body = otpMessageBody();
    const headers = { 'x-trace': 'abc', [ATTEMPT_HEADER]: 5 };
    const msg = fakeMessage(body, headers);

    await handler(msg);

    expect(mocks.publish).toHaveBeenCalledWith(
      DLQ_EXCHANGE,
      OTP_EMAIL_ROUTING_KEY,
      body,
      { headers, persistent: true },
    );
    expect(mocks.ack).toHaveBeenCalledWith(msg);
    expect(mocks.nack).not.toHaveBeenCalled();
  });

  it('clamps an oversized attempt header before dead-lettering', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const body = otpMessageBody();
    const msg = fakeMessage(body, { [ATTEMPT_HEADER]: '99' });

    await handler(msg);

    expect(mocks.publish).toHaveBeenCalledWith(
      DLQ_EXCHANGE,
      OTP_EMAIL_ROUTING_KEY,
      body,
      { headers: { [ATTEMPT_HEADER]: '99' }, persistent: true },
    );
  });

  it('acks a duplicate messageId without sending twice', async () => {
    const body = otpMessageBody();
    // First delivery marks the id in the store; the redelivery sees it as
    // already present (SET NX returns null).
    mocks.redisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await handler(fakeMessage(body));
    await handler(fakeMessage(body));

    expect(mocks.ack).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('resends a distinct messageId', async () => {
    await handler(fakeMessage(otpMessageBody({ messageId: UUID_A })));
    await handler(fakeMessage(otpMessageBody({ messageId: UUID_B })));

    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.ack).toHaveBeenCalledTimes(2);
  });

  it('logs a server-cancelled consumer without touching the broker', async () => {
    await handler(null);

    expect(loggerInfo).toHaveBeenCalledWith('Consumer cancelled by server');
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.nack).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('requeues the original when the retry publish fails', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    mocks.publish.mockImplementationOnce(() => {
      throw new Error('channel closed');
    });
    const msg = fakeMessage(otpMessageBody(), { [ATTEMPT_HEADER]: 1 });

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, true);
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      'Retry publish failed',
    );
  });

  it('requeues the original when the retry publish is not buffered', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    mocks.publish.mockReturnValueOnce(false);
    const msg = fakeMessage(otpMessageBody(), { [ATTEMPT_HEADER]: 2 });

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, true);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('requeues the original when the dead-letter publish is not buffered', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    mocks.publish.mockReturnValueOnce(false);
    const msg = fakeMessage(otpMessageBody(), { [ATTEMPT_HEADER]: 5 });

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, true);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('requeues the original when the dead-letter publish fails', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('smtp down'));
    mocks.publish.mockImplementationOnce(() => {
      throw new Error('channel closed');
    });
    const msg = fakeMessage(otpMessageBody(), { [ATTEMPT_HEADER]: 5 });

    await handler(msg);

    expect(mocks.nack).toHaveBeenCalledWith(msg, false, true);
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 5 }),
      'Dead-letter publish failed',
    );
  });
});