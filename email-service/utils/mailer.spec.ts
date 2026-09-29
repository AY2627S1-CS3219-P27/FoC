import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { readFileSyncMock, sendMailMock } = vi.hoisted(() => {
  const readFileSyncMock = vi.fn();
  const sendMailMock = vi.fn();
  return { readFileSyncMock, sendMailMock };
});

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: readFileSyncMock,
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
  createTransport: () => ({ sendMail: sendMailMock }),
}));

let sendEmail: typeof import('./mailer.ts').sendEmail;

// mailer reads SMTP envs and the SMTP secret file at import time, so the
// environment must be seeded before the module is first imported.
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

  ({ sendEmail } = await import('./mailer.ts'));

  // Pin the secret-file contract at load time, while the call history is
  // still visible: the SMTP password must come from the env-configured file,
  // read with a trailing-newline trim (Docker secret files carry one).
  expect(readFileSyncMock).toHaveBeenCalledWith(
    '/run/secrets/smtp_password',
    'utf8',
  );
});

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: 'test-id' });
});

describe('sendEmail', () => {
  it('sends from the configured address to the recipient with all fields', async () => {
    await sendEmail('student@example.com', 'Subject line', 'text body', '<p>html</p>');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'test@foc.com',
      to: 'student@example.com',
      subject: 'Subject line',
      text: 'text body',
      html: '<p>html</p>',
    });
  });
});