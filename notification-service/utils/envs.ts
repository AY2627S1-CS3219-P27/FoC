import { z } from 'zod';

/**
 * Validates the whole environment up front when the app boots.
 *
 * Covers every variable in `env/notification-service.env.example`: an invalid
 * setup fails fast with all offending keys reported together instead of
 * surfacing later as confusing errors at the point of use.
 */
const envSchema = z.object({
  // HTTP server (internal only; the frontend proxies /api/notifications/*)
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

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

  // Postgres (drizzle)
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_USERNAME: z.string().trim().min(1),
  DB_DATABASE: z.string().trim().min(1),
  DB_PASSWORD_FILE: z.string().trim().min(1),
});

export const envs = envSchema.parse(process.env);
