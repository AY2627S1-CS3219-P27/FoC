import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));
const sendMailMock = vi.fn();
const fakeRedis = { set: vi.fn(), del: vi.fn(), on: vi.fn() };

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: readFileSyncMock,
}));

// The app wires the broker at import time (top-level IIFE); stub amqplib so
// importing it in tests does not open a real connection.
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      on: vi.fn(),
      createChannel: vi.fn().mockResolvedValue({
        on: vi.fn(),
        assertExchange: vi.fn().mockResolvedValue(undefined),
        assertQueue: vi.fn().mockResolvedValue(undefined),
        bindQueue: vi.fn().mockResolvedValue(undefined),
        consume: vi.fn(),
        ack: vi.fn(),
        nack: vi.fn(),
        publish: vi.fn(),
      }),
    }),
  },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: sendMailMock }),
  },
  createTransport: () => ({ sendMail: sendMailMock }),
}));

vi.mock('ioredis', () => ({
  // `new Redis(...)` must be constructable; the mock returns the shared fake.
  Redis: vi.fn().mockImplementation(function () {
    return fakeRedis;
  }),
}));

let processOtpEmailMessage: typeof import('./app.ts').processOtpEmailMessage;
let attemptOf: typeof import('./app.ts').attemptOf;
let RETRY_EXCHANGE: string;
let DLQ_EXCHANGE: string;
let BACK_EXCHANGE: string;
let OTP_QUEUE: string;
let RETRY_QUEUE: string;
let DLQ_QUEUE: string;
let OTP_EMAIL_ROUTING_KEY: string;

const UUID_A = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';
const UUID_B = '7d1f9e0a-2c5b-4d8e-a9f0-4b5c6d7e8f90';
const DEDUP_KEY_A = `email:seen:${UUID_A}`;

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
  readFileSyncMock.mockReturnValue('test-password\n');

  ({ processOtpEmailMessage, attemptOf } = await import('./app.ts'));
  ({
    RETRY_EXCHANGE,
    DLQ_EXCHANGE,
    BACK_EXCHANGE,
    OTP_QUEUE,
    RETRY_QUEUE,
    DLQ_QUEUE,
    OTP_EMAIL_ROUTING_KEY,
  } = await import('./app.ts'));
  (await import('./logger.ts')).logger.level = 'silent';

  // Pin the secret-file contract at load time: both passwords must come from
  // their env-configured files, read with a trailing-newline trim.
  expect(readFileSyncMock).toHaveBeenCalledWith(
    '/run/secrets/smtp_password',
    'utf8',
  );
  expect(readFileSyncMock).toHaveBeenCalledWith(
    '/run/secrets/rabbitmq_password',
    'utf8',
  );
});

beforeEach(() => {
  fakeRedis.set.mockReset();
  fakeRedis.del.mockReset();
  // Default: the store is up and the id was not seen before (SET NX -> 'OK').
  fakeRedis.set.mockResolvedValue('OK');
  fakeRedis.del.mockResolvedValue(1);
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test-id' });
});

describe('processOtpEmailMessage', () => {
  it('sends exactly one OTP email with html and text', async () => {
    const outcome = await processOtpEmailMessage(otpMessageBody());

    expect(outcome).toEqual({ action: 'acked' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(fakeRedis.set).toHaveBeenCalledWith(
      DEDUP_KEY_A,
      '1',
      'EX',
      900,
      'NX',
    );

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.from).toBe('test@foc.com');
    expect(mail.to).toBe('student@example.com');
    expect(mail.subject).toBe('Your OTP is here');
    expect(mail.text).toContain('abc123');
    expect(mail.html).toContain('abc123');
  });

  it('acks a crash-redelivered message without resending it', async () => {
    // First delivery marks the id; the redelivery sees it as already present.
    fakeRedis.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);
    const body = otpMessageBody();

    expect(await processOtpEmailMessage(body, 1)).toEqual({
      action: 'acked',
    });
    expect(await processOtpEmailMessage(body, 2)).toEqual({
      action: 'acked',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('sends again for a distinct messageId', async () => {
    await processOtpEmailMessage(
      otpMessageBody({ messageId: UUID_A, otp: 'aaa111' }),
    );
    await processOtpEmailMessage(
      otpMessageBody({ messageId: UUID_B, otp: 'bbb222' }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('sends anyway when the dedup store is unavailable (fail-open)', async () => {
    fakeRedis.set.mockRejectedValue(new Error('redis down'));

    const outcome = await processOtpEmailMessage(otpMessageBody());

    expect(outcome).toEqual({ action: 'acked' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('drops a message with an invalid messageId', async () => {
    const outcome = await processOtpEmailMessage(
      otpMessageBody({ messageId: 'not-a-uuid' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a malformed JSON payload', async () => {
    const outcome = await processOtpEmailMessage(Buffer.from('not json'));

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('drops a message with a code outside the OTP charset', async () => {
    const outcome = await processOtpEmailMessage(
      otpMessageBody({ otp: '!!!!!!' }),
    );

    expect(outcome).toEqual({ action: 'dropped' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('requests a retry with the first backoff delay on send failure', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processOtpEmailMessage(otpMessageBody(), 1);

    expect(outcome).toEqual({
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });
  });

  it('steps the backoff delay per attempt', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'));

    expect(await processOtpEmailMessage(otpMessageBody(), 2)).toEqual({
      action: 'retry',
      delayMs: 120_000,
      nextAttempt: 3,
    });
    expect(await processOtpEmailMessage(otpMessageBody(), 4)).toEqual({
      action: 'retry',
      delayMs: 480_000,
      nextAttempt: 5,
    });
  });

  it('dead-letters after the final attempt', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));

    const outcome = await processOtpEmailMessage(otpMessageBody(), 5);

    expect(outcome).toEqual({ action: 'dead-letter' });
  });

  it('clears the dedup mark on failure so the retried copy is not skipped', async () => {
    sendMailMock
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce({ messageId: 'test-id' });
    const body = otpMessageBody();

    expect(await processOtpEmailMessage(body, 1)).toEqual({
      action: 'retry',
      delayMs: 60_000,
      nextAttempt: 2,
    });
    expect(fakeRedis.del).toHaveBeenCalledWith(DEDUP_KEY_A);
    // The retried copy (same messageId) is treated as a fresh delivery.
    expect(await processOtpEmailMessage(body, 2)).toEqual({
      action: 'acked',
    });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('still retries when clearing the dedup mark fails (fail-open)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));
    fakeRedis.del.mockRejectedValue(new Error('redis down'));

    const outcome = await processOtpEmailMessage(otpMessageBody(), 3);

    expect(outcome).toEqual({
      action: 'retry',
      delayMs: 240_000,
      nextAttempt: 4,
    });
  });
});

describe('attemptOf', () => {
  it.each([
    [undefined, 1],
    [0, 1],
    [-3, 1],
    ['abc', 1],
    [2, 2],
    ['3', 3],
    ['99', 5],
  ])('maps %s to %s', (raw, expected) => {
    expect(attemptOf(raw)).toBe(expected);
  });
});

describe('retry topology', () => {
  it('pins the resource names asserted at startup and seeded in definitions.json', () => {
    // app.ts asserts these with args matching rabbitmq/definitions.json; a
    // rename here or in the seed would otherwise break the retry loop
    // silently.
    expect(RETRY_EXCHANGE).toBe('foc.retry');
    expect(DLQ_EXCHANGE).toBe('foc.dlq');
    expect(BACK_EXCHANGE).toBe('foc.back');
    expect(OTP_QUEUE).toBe('otp_emails');
    expect(RETRY_QUEUE).toBe('otp_emails.retry');
    expect(DLQ_QUEUE).toBe('otp_emails.dlq');
    expect(OTP_EMAIL_ROUTING_KEY).toBe('otp.email');
  });
});