import { z } from 'zod';
/**
 * Validates the whole environment up front when the app boots.
 *
 * Covers every variable in `.env.example`: an invalid setup fails fast with
 * all offending keys reported together instead of surfacing later as
 * confusing errors at the point of use.
 */
const envSchema = z.object({
  // SMTP (nodemailer transport)
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),
  SMTP_USER: z.string().trim().min(1),
  SMTP_PASS_FILE: z.string().trim().min(1),
  SMTP_FROM_EMAIL: z.email(),

  // Logging (pino)
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // RabbitMQ broker
  RABBITMQ_USER: z.string().trim().min(1),
  RABBITMQ_HOST: z.string().trim().min(1),
  RABBITMQ_PORT: z.coerce.number().int().min(1).max(65535),
  RABBITMQ_VHOST: z.string().trim().min(1),
  RABBITMQ_PASSWORD_FILE: z.string().trim().min(1),

  // Redis (shared dedup store)
  REDIS_HOST: z.string().trim().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_USERNAME: z.string().trim().min(1),
  REDIS_DB_INDEX: z.coerce.number().int().min(0),
});

export const envs = envSchema.parse(process.env);
