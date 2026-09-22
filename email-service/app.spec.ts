import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Logger } from 'pino';

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));
const sendMail = vi.fn();

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: readFileSyncMock,
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
  createTransport: () => ({ sendMail }),
}));

let app: Express;
let logger: Logger;

beforeAll(async () => {
  process.env.SMTP_HOST = 'localhost';
  process.env.SMTP_PORT = '2525';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'test';
  process.env.SMTP_PASS_FILE = '/run/secrets/smtp_password';
  readFileSyncMock.mockReturnValue('test-password\n');
  process.env.SMTP_FROM_EMAIL = 'test@foc.com';
  process.env.LOG_LEVEL = 'error';

  ({ app, logger } = await import('./app.ts'));
  logger.level = 'silent';

  // Pin the secret-file contract at load time: the SMTP password must come
  // from SMTP_PASS_FILE, read with a trailing-newline trim.
  expect(readFileSyncMock).toHaveBeenCalledWith(
    '/run/secrets/smtp_password',
    'utf8',
  );
});

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: 'test-id' });
});

describe('POST /email', () => {
  it('sends exactly one OTP email with html and text', async () => {
    const res = await request(app)
      .post('/email')
      .send({
        type: 'OTP',
        recipient: 'student@example.com',
        content: { otp: 'abc123', expiry: 10, subject: 'Your OTP' },
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toBe('test@foc.com');
    expect(mail.to).toBe('student@example.com');
    expect(mail.subject).toBe('Your OTP');
    expect(mail.text).toContain('abc123');
    expect(mail.html).toContain('abc123');
  });

  it('escapes the OTP code in the rendered html', async () => {
    const res = await request(app)
      .post('/email')
      .send({
        type: 'OTP',
        recipient: 'student@example.com',
        content: { otp: '<b>&"\'', expiry: 10, subject: 'Your OTP' },
      });

    expect(res.status).toBe(200);
    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;');
    expect(html).not.toContain('<b>');
  });

  it('sends a generic text-only email for non-OTP types', async () => {
    const res = await request(app)
      .post('/email')
      .send({
        type: 'NOTICE',
        recipient: 'student@example.com',
        content: { message: 'Hello there', subject: 'Hi' },
      });

    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).toBe('Hello there');
    expect(mail.html).toBeUndefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/email').send({ type: 'OTP' });

    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns 500 when SMTP delivery fails', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));

    const res = await request(app)
      .post('/email')
      .send({
        type: 'OTP',
        recipient: 'student@example.com',
        content: { otp: '123456', expiry: 10, subject: 'Your OTP' },
      });

    expect(res.status).toBe(500);
  });
});
