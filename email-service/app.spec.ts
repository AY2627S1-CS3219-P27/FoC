import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ConsumeMessage } from 'amqplib';

/**
 * The broker wiring lives in a top-level IIFE inside `app.ts`, so it runs the
 * moment the module is imported and cannot be invoked directly. The IIFE calls
 * `connect` with a recovery `setup` option; this test drives `connect` (so it
 * can read those options) and then invokes `setup` to emulate the recovery
 * library calling it on connect and on every reconnect, letting us capture the
 * register/consume calls exactly as amqplib would.
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
  const connectionClose = vi.fn().mockResolvedValue(undefined);
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
  const connection = { on: connectionOn, createChannel, close: connectionClose };

  return {
    readFileSync,
    sendMail,
    connect,
    createChannel,
    connectionOn,
    channelOn,
    connectionClose,
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
type Setup = (model: unknown) => Promise<unknown>;

let otpHandler: Handler;
let resetHandler: Handler;
let setup: Setup;
let loggerInfo: MockInstance;
let loggerError: MockInstance;

let connectCalls: unknown[][];
let connectOptions: unknown;

type RecoveryOptions = { recovery: { setup: Setup } };

/** Startup-side calls, snapshotted before `clearMocks` can wipe them. */
let wiring: {
  brokerUrl: unknown;
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

  // The IIFE awaits connect, then the recovery library runs the setup callback.
  // `connect` is mocked, so we snapshot what it received (mock call history is
  // cleared before each test) and run setup ourselves to emulate that first
  // (re)connect.
  connectCalls = mocks.connect.mock.calls.splice(0);
  connectOptions = connectCalls[0][1];
  setup = (connectOptions as RecoveryOptions).recovery.setup;
  await setup(mocks.connection);

  loggerInfo = vi.mocked(logger.info);
  loggerError = vi.mocked(logger.error);

  await vi.waitFor(() => expect(mocks.consume).toHaveBeenCalledTimes(2));
  otpHandler = mocks.consume.mock.calls.find(
    (call) => call[0] === 'otp_emails',
  )?.[1] as Handler;
  resetHandler = mocks.consume.mock.calls.find(
    (call) => call[0] === 'password_reset_emails',
  )?.[1] as Handler;
  wiring = {
    brokerUrl: connectCalls[0][0],
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
  loggerError.mockClear();
  // connection-close counter and transport call history are per-test to keep
  // the reconnect assertions order-independent.
  mocks.connectionClose.mockReset();
  mocks.connectionClose.mockResolvedValue(undefined);
});

describe('startup IIFE', () => {
  it('connects to the broker with URL-encoded credentials from the trimmed secret file', () => {
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0][0]).toBe(
      'amqp://email-service:p%40ss%2Fword@rabbitmq:5672/%2Ffoc',
    );
  });

  it('passes amqplib a recovery policy that retries forever with the same backoff as the other services', () => {
    const recovery = (connectOptions as {
      recovery: {
        initialDelay: number;
        maxDelay: number;
        factor: number;
        jitter: number;
        maxRetries: number;
        setup: unknown;
      };
    }).recovery;
    expect(recovery.initialDelay).toBe(100);
    expect(recovery.maxDelay).toBe(30_000);
    expect(recovery.factor).toBe(2);
    expect(recovery.jitter).toBe(0.2);
    expect(recovery.maxRetries).toBe(Number.POSITIVE_INFINITY);
    expect(typeof recovery.setup).toBe('function');
  });

  it('registers the full recovery lifecycle event log on the connection', () => {
    expect(wiring.connectionEvents).toEqual([
      'connect',
      'disconnect',
      'reconnect-scheduled',
      'connect-failed',
      'reconnect-failed',
      'blocked',
      'unblocked',
      'error',
      'handler-error',
    ]);
  });

  it('creates one channel and registers error/handler-error/close listeners on it', () => {
    expect(wiring.createChannelCount).toBe(1);
    expect(wiring.channelEvents).toEqual(['error', 'handler-error', 'close']);
  });

  it('asserts the broker topology before consuming', () => {
    expect(wiring.assertExchangeCalls.length).toBeGreaterThan(0);
    expect(wiring.assertQueueCalls.length).toBeGreaterThan(0);
    expect(wiring.bindQueueCalls.length).toBeGreaterThan(0);
  });

  it('registers one consumer per email listener', () => {
    expect(wiring.consumeCalls).toHaveLength(2);
    expect(wiring.consumeCalls.map((call) => call[0])).toEqual([
      'otp_emails',
      'password_reset_emails',
    ]);
  });

  it('logs connection and channel handler errors instead of crashing', () => {
    for (const fn of wiring.connectionHandlers) {
      fn(new Error('connection boom'), 'error');
    }
    for (const fn of wiring.channelHandlers) {
      fn(new Error('channel boom'), 'error');
    }

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Connection error'),
    );
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Uncaught exception in connection'),
    );
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Channel error'),
    );
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Uncaught exception in channel'),
    );
  });
});

describe('reconnect', () => {
  it('re-registers topology and both consumers after a reconnect', async () => {
    const beforeChannels = mocks.createChannel.mock.calls.length;
    const beforeConsumers = mocks.consume.mock.calls.length;
    const beforeAssertQueue = mocks.assertQueue.mock.calls.length;

    await setup(mocks.connection);

    // One channel is recreated per (re)connect, both consumers are reinstalled,
    // and the full topology is re-asserted so drift never silently breaks it.
    expect(mocks.createChannel.mock.calls.length).toBe(beforeChannels + 1);
    expect(mocks.consume.mock.calls.length).toBe(beforeConsumers + 2);
    expect(mocks.assertQueue.mock.calls.length).toBeGreaterThan(
      beforeAssertQueue,
    );
  });

  it('recycles the connection when the server cancels a consumer', async () => {
    await setup(mocks.connection);

    const otpHandlerAtReconnect = mocks.consume.mock.calls.find(
      (call) => call[0] === 'otp_emails',
    )?.[1] as Handler;
    await otpHandlerAtReconnect(null);

    expect(mocks.connectionClose).toHaveBeenCalledTimes(1);
  });

  it('recycles the connection when the channel closes', async () => {
    await setup(mocks.connection);

    const [closeHandler] = mocks.channelOn.mock.calls
      .filter((call) => call[0] === 'close')
      .map((call) => call[1] as UnknownFn);
    closeHandler();

    expect(mocks.connectionClose).toHaveBeenCalledTimes(1);
  });

  it('recycles the connection only once per outage', async () => {
    await setup(mocks.connection);

    const [closeHandler] = mocks.channelOn.mock.calls
      .filter((call) => call[0] === 'close')
      .map((call) => call[1] as UnknownFn);

    const otpHandlerAtReconnect = mocks.consume.mock.calls.find(
      (call) => call[0] === 'otp_emails',
    )?.[1] as Handler;

    await otpHandlerAtReconnect(null);
    closeHandler();

    expect(mocks.connectionClose).toHaveBeenCalledTimes(1);
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

  it('logs a server-cancelled consumer as an error', async () => {
    await otpHandler(null);

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Consumer cancelled by server'),
    );
  });

  it('wires the password-reset queue to its own consumer', async () => {
    const msg = fakeMessage(
      Buffer.from(
        JSON.stringify({
          data: {
            messageId: UUID,
            recipient: 'student@example.com',
            resetLink: 'https://foc.example/reset-password?token=abc',
            subject: 'Reset your password',
            expiry: 10,
          },
        }),
      ),
    );

    await resetHandler(msg);

    expect(mocks.ack).toHaveBeenCalledWith(msg);
    expect(mocks.nack).not.toHaveBeenCalled();
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        subject: 'Reset your password',
        text: expect.stringContaining(
          'https://foc.example/reset-password?token=abc',
        ),
        html: expect.stringContaining(
          'https://foc.example/reset-password?token=abc',
        ),
      }),
    );
  });
});
