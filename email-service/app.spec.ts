import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ConsumeMessage } from 'amqplib';

/**
 * The broker wiring lives in a top-level IIFE inside `app.ts`, so it runs the
 * moment the module is imported and cannot be invoked directly. These mocks
 * capture the `consume` callbacks the IIFE registers, letting us drive the
 * dispatch logic (ack/nack/republish) exactly as RabbitMQ would.
 *
 * Everything under `utils/` is mocked here so importing `app.ts` needs no
 * environment, SMTP, Redis or broker: the per-module specs cover those in
 * isolation.
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
  const redisConnect = vi.fn();

  const redis = {
    set: redisSet,
    del: redisDel,
    on: redisOn,
    connect: redisConnect,
  };

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
    redisConnect,
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

vi.mock('redis', () => ({
  createClient: vi.fn().mockImplementation(function () {
    return mocks.redis;
  }),
}));

vi.mock('./utils/envs.ts', () => ({
  envs: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: 2525,
    SMTP_SECURE: false,
    SMTP_USER: 'test',
    SMTP_PASS_FILE: '/run/secrets/smtp_password',
    SMTP_FROM_EMAIL: 'test@foc.com',
    LOG_LEVEL: 'silent',
    RABBITMQ_USER: 'email-service',
    RABBITMQ_HOST: 'rabbitmq',
    RABBITMQ_PORT: 5672,
    RABBITMQ_VHOST: '/foc',
    RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq_password',
    REDIS_HOST: 'redis',
    REDIS_PORT: 6379,
    REDIS_USERNAME: 'default',
    REDIS_DB_INDEX: 0,
  },
}));

vi.mock('./utils/logger.ts', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { logger } from './utils/logger.ts';

type Handler = (msg: ConsumeMessage | null) => Promise<void>;
type UnknownFn = (...args: unknown[]) => void;

let otpHandler: Handler;
let loggerInfo: MockInstance;
let loggerError: MockInstance;

/** Startup-side calls, snapshotted before `clearMocks` can wipe them. */
let wiring: {
  brokerUrl: unknown;
  connectCalls: unknown[][];
  createChannelCount: number;
  assertExchangeCalls: unknown[][];
  assertQueueCalls: unknown[][];
  bindQueueCalls: unknown[][];
  consumeCalls: unknown[][];
  connectionEvents: string[];
  channelEvents: string[];
  connectionHandlers: UnknownFn[];
  channelHandlers: UnknownFn[];
};

const UUID = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';

/** Build a broker-enveloped OTP email message (`{ data: {...} }`). */
function otpMessageBody(): Buffer {
  return Buffer.from(
    JSON.stringify({
      data: {
        messageId: UUID,
        recipient: 'student@example.com',
        otp: 'abc123',
        subject: 'Your OTP is here',
        expiry: 10,
      },
    }),
  );
}

/** Minimal `ConsumeMessage` stand-in carrying content and routing key. */
function fakeMessage(content: Buffer): ConsumeMessage {
  return {
    content,
    properties: { headers: {} },
    fields: { routingKey: 'otp.email' },
  } as unknown as ConsumeMessage;
}

beforeAll(async () => {
  // Distinct secrets per file so the broker-URL assertion pins the rabbitmq one
  // and the special characters exercise URL encoding.
  mocks.readFileSync.mockImplementation((path: string) =>
    path.includes('rabbitmq') ? 'p@ss/word\n' : 'smtp-pass\n',
  );
  mocks.connect.mockResolvedValue(mocks.connection);
  mocks.createChannel.mockResolvedValue(mocks.channel);
  mocks.assertExchange.mockResolvedValue(undefined);
  mocks.assertQueue.mockResolvedValue(undefined);
  mocks.bindQueue.mockResolvedValue(undefined);
  mocks.redisConnect.mockResolvedValue(undefined);

  await import('./app.ts');
  loggerInfo = vi.mocked(logger.info);
  loggerError = vi.mocked(logger.error);

  // The IIFE awaits connect/createChannel/assertTopology before consuming;
  // give those microtasks time to settle, then capture the OTP handler and
  // snapshot the wiring calls before `clearMocks` wipes them.
  await vi.waitFor(() =>
    expect(
      mocks.consume.mock.calls.some((call) => call[0] === 'otp_emails'),
    ).toBe(true),
  );
  otpHandler = mocks.consume.mock.calls.find(
    (call) => call[0] === 'otp_emails',
  )?.[1] as Handler;
  wiring = {
    brokerUrl: mocks.connect.mock.calls[0]?.[0],
    connectCalls: mocks.connect.mock.calls.splice(0),
    createChannelCount: mocks.createChannel.mock.calls.length,
    assertExchangeCalls: mocks.assertExchange.mock.calls.splice(0),
    assertQueueCalls: mocks.assertQueue.mock.calls.splice(0),
    bindQueueCalls: mocks.bindQueue.mock.calls.splice(0),
    consumeCalls: mocks.consume.mock.calls.splice(0),
    connectionEvents: mocks.connectionOn.mock.calls.map((c) => c[0] as string),
    channelEvents: mocks.channelOn.mock.calls.map((c) => c[0] as string),
    connectionHandlers: mocks.connectionOn.mock.calls.map(
      (c) => c[1] as UnknownFn,
    ),
    channelHandlers: mocks.channelOn.mock.calls.map((c) => c[1] as UnknownFn),
  };

  // Pin the rabbitmq secret-file contract at load time, while the call history
  // is still visible: the pass must come from the env-configured file, read
  // with a trailing-newline trim so the broker URL never carries the newline.
  expect(mocks.readFileSync).toHaveBeenCalledWith(
    '/run/secrets/rabbitmq_password',
    'utf8',
  );
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
  loggerInfo.mockClear();
});

describe('startup IIFE', () => {
  it('connects to the broker with URL-encoded credentials from the trimmed secret file', () => {
    expect(wiring.connectCalls).toHaveLength(1);
    expect(wiring.brokerUrl).toBe(
      'amqp://email-service:p%40ss%2Fword@rabbitmq:5672/%2Ffoc',
    );
  });

  it('creates one channel and registers error/handler-error listeners on it and the connection', () => {
    expect(wiring.createChannelCount).toBe(1);
    expect(wiring.connectionEvents).toEqual(['error', 'handler-error']);
    expect(wiring.channelEvents).toEqual(['error', 'handler-error']);
    expect(wiring.connectionHandlers).toHaveLength(2);
    expect(wiring.channelHandlers).toHaveLength(2);
  });

  it('asserts the broker topology before consuming', () => {
    expect(wiring.assertExchangeCalls.length).toBeGreaterThan(0);
    expect(wiring.assertQueueCalls.length).toBeGreaterThan(0);
    expect(wiring.bindQueueCalls.length).toBeGreaterThan(0);
  });

  it('registers a consumer for the OTP email listener', () => {
    const otp = wiring.consumeCalls.find((call) => call[0] === 'otp_emails');
    expect(otp).toBeDefined();
    expect(typeof otp?.[1]).toBe('function');
  });

  it('logs connection and channel handler errors instead of crashing', () => {
    for (const fn of wiring.connectionHandlers) {
      fn(new Error('connection boom'), 'error');
    }
    for (const fn of wiring.channelHandlers) {
      fn(new Error('channel boom'), 'error');
    }

    expect(loggerError).toHaveBeenCalledTimes(4);
  });
});

describe('consume handler dispatch wiring', () => {
  it('acks a successfully delivered OTP email end-to-end through the listener', async () => {
    const msg = fakeMessage(otpMessageBody());

    await otpHandler(msg);

    expect(mocks.ack).toHaveBeenCalledWith(msg);
    expect(mocks.nack).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.redisSet).toHaveBeenCalledWith(`email:seen:${UUID}`, '1', {
      EX: 900,
      NX: true,
    });
  });

  it('logs a server-cancelled consumer without touching the broker', async () => {
    await otpHandler(null);

    expect(loggerInfo).toHaveBeenCalledWith('Consumer cancelled by server');
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.nack).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
