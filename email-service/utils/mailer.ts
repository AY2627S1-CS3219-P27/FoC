import nodemailer from 'nodemailer';
import { envs } from './envs.ts';
import { readFileSync } from 'node:fs';

const SMTP_PASS = readFileSync(envs.SMTP_PASS_FILE, 'utf8').trim();

const transport = nodemailer.createTransport({
  host: envs.SMTP_HOST,
  port: envs.SMTP_PORT,
  secure: envs.SMTP_SECURE,
  auth: {
    user: envs.SMTP_USER,
    pass: SMTP_PASS,
  },
});

export async function sendEmail(
  recipient: string,
  subject: string,
  text: string,
  html?: string,
) {
  return transport.sendMail({
    from: envs.SMTP_FROM_EMAIL,
    to: recipient,
    subject: subject,
    text,
    html,
  });
}
