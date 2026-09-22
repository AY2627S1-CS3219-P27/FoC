import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { pino } from 'pino';
import { renderOtpEmail } from './templates/otp.ts';
import {
  checkSchema,
  validationResult,
  type CustomValidator,
  type Meta,
} from 'express-validator';

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

const TYPE_OTP = 'OTP';
const TYPE_GENERIC = 'GENERIC';

// Conditions a field chain on the request type, so OTP-only and GENERIC-only
// content fields are only validated for the matching payload.
const isTypeOf =
  (expected: string): CustomValidator =>
  (_value, { req }: Meta) =>
    (req.body as { type?: string } | undefined)?.type === expected;

app.post(
  '/email',
  checkSchema(
    {
      type: {
        isString: true,
        isIn: {
          // checkSchema spreads `options` as positional args, so array-taking
          // validators need their values nested one level.
          options: [[TYPE_GENERIC, TYPE_OTP]],
          errorMessage: `'Type' Must be ${TYPE_GENERIC} or ${TYPE_OTP}`,
        },
      },
      recipient: {
        isEmail: true,
      },
      content: {
        isObject: true,
      },
      'content.subject': {
        isString: true,
        notEmpty: true,
        errorMessage: 'content.subject must be a non-empty string',
      },
      'content.otp': {
        isString: {
          if: isTypeOf(TYPE_OTP),
          errorMessage: 'content.otp must be a string for OTP emails',
        },
        notEmpty: {
          if: isTypeOf(TYPE_OTP),
          errorMessage: 'content.otp is required for OTP emails',
        },
      },
      'content.expiry': {
        isInt: {
          options: { min: 1 },
          if: isTypeOf(TYPE_OTP),
          errorMessage:
            'content.expiry must be a positive integer for OTP emails',
        },
      },
      'content.message': {
        isString: {
          if: isTypeOf(TYPE_GENERIC),
          errorMessage: 'content.message must be a string for GENERIC emails',
        },
        notEmpty: {
          if: isTypeOf(TYPE_GENERIC),
          errorMessage: 'content.message is required for GENERIC emails',
        },
      },
    },
    // Scope the chains to the JSON body.
    ['body'],
  ),

  (req: Request, res: Response, next: NextFunction) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      res.status(400).json({ errors: result.array() });
      return;
    }
    next();
  },

  async (req: Request, res: Response) => {
    try {
      const { type, content, recipient } = req.body;

      await handleEmail(type, content, recipient);
      res.send('OK');
    } catch (error) {
      logger.error({ err: error }, 'Failed to send email');
      res.status(500).send('Failed to send email');
    }
  },
);

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
