import Joi from 'joi';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

// "1000,2000,..." -> five strictly increasing positive delays (the consumer
// owns one retry queue per entry).
const retryDelaysSchema = Joi.any()
  .default(DEFAULT_RETRY_DELAYS_MS)
  .custom((value: unknown, helpers) => {
    if (typeof value !== 'string') {
      return helpers.error('any.invalid');
    }
    const delays = value.split(',').map((delay) => Number(delay.trim()));
    if (
      delays.length !== 5 ||
      delays.some((delay) => !Number.isSafeInteger(delay) || delay <= 0) ||
      delays.some((delay, index) => index > 0 && delay <= delays[index - 1])
    ) {
      return helpers.error('any.invalid');
    }
    return delays;
  }, 'RabbitMQ retry delays');

/**
 * Validates the whole environment up front when the app boots.
 *
 * All env vars a service reads are validated here: an invalid setup fails
 * fast with the offending keys reported together, instead of surfacing as
 * confusing errors later at the point of use.
 */
export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error', 'fatal')
    .default('log'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string()
    .uri()
    .default('http://localhost:4318'),

  // Postgres (TypeORM). The schema is migration-owned.
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  DB_MIGRATIONS_RUN: Joi.boolean().default(true),

  // user-service's RS256 verification key, mounted from its public-key secret.
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),

  // VAPID public key browsers pass to pushManager.subscribe. Not sensitive;
  // the private key is a mounted secret used by the sending side.
  VAPID_PUBLIC_KEY: Joi.string().min(1).required(),
  VAPID_PRIVATE_KEY_FILE: Joi.string().min(1).required(),
  // Contact identity for the push service (mailto: or https: URL).
  VAPID_SUBJECT: Joi.string().min(1).required(),

  // RabbitMQ broker identity for the inbox consumer.
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().port().required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
