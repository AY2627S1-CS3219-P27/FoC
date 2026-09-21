import express, { type Express, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { pino } from 'pino';
import { renderOtpEmail } from './templates/otp.ts';

// ── Logger (pino) ───────────────────────────────────────────────
const LOG_LEVEL_ALIASES: Record<string, string> = {
  log: 'info',
  verbose: 'debug',
};
const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const rawLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const resolvedLevel =
  LOG_LEVEL_ALIASES[rawLevel] ??
  (PINO_LEVELS.includes(rawLevel) ? rawLevel : 'info');

export const logger = pino({
  level: resolvedLevel,
  base: { service: 'email-service' },
});

const app: Express = express();
app.use(express.json());

const path = process.env.SMTP_PASS_FILE;
if (!path) {
  throw new Error(`Environment variable SMTP_PASS_FILE is not set`);
}
const SMTP_PASS = readFileSync(path, 'utf8').trim();

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: SMTP_PASS,
  },
});

app.post('/email', async (req: Request, res: Response) => {
  try {
    const { type, content, recipient } = req.body;

    if (type === undefined || content === undefined || recipient === undefined) {
      res.status(400).send('type, content and recipient are required');
      return;
    }

    await handleEmail(type, content, recipient);
    res.send('OK');
  } catch (error) {
    logger.error({ err: error }, 'Failed to send email');
    res.status(500).send('Failed to send email');
  }
});

async function handleEmail(type: string, content: any, recipient: string) {
  let text: string | undefined;
  let html: string | undefined;

  if (type === 'OTP') {
    const rendered = renderOtpEmail({
      otp: content.otp,
      expiresInMinutes: content.expiry,
    });
    text = rendered.text;
    html = rendered.html;
  } else {
    // Generic text email
    text = content.message;
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM_EMAIL,
    to: recipient,
    subject: content.subject,
    text,
    html,
  });
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(3000);
}

export { app };
