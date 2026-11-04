import Joi from 'joi';

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

  // Postgres (TypeORM); consumed from Step 2 when the database module lands.
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),

  // user-service's RS256 verification key, mounted from its public-key secret.
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),

  // RabbitMQ broker identity; consumed once the consumer module lands.
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().port().required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
