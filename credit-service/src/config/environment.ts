import Joi from 'joi';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  INITIAL_CREDIT_BALANCE: number;
  RABBITMQ_URL: string;
  RABBITMQ_EXCHANGE: string;
  RABBITMQ_USER_REGISTERED_QUEUE: string;
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: string;
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: string;
  RABBITMQ_RETRY_EXCHANGE: string;
  RABBITMQ_DEAD_LETTER_EXCHANGE: string;
  RABBITMQ_PREFETCH: number;
  RABBITMQ_RETRY_DELAYS_MS: number[];
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_BATCH_SIZE: number;
  OUTBOX_CLAIM_LEASE_MS: number;
  OUTBOX_UNPUBLISHED_WARNING_MS: number;
}

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

export const environmentSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  INITIAL_CREDIT_BALANCE: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(100),
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .required(),
  RABBITMQ_EXCHANGE: Joi.string().min(1).default('foc.events'),
  RABBITMQ_USER_REGISTERED_QUEUE: Joi.string()
    .min(1)
    .default('credit-service.user-registered.v1'),
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: Joi.string()
    .min(1)
    .default('user.registered.v1'),
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: Joi.string()
    .min(1)
    .default('credit.account-initialised.v1'),
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.credit.retry'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string().min(1).default('foc.credit.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).default(100),
  OUTBOX_CLAIM_LEASE_MS: Joi.number().integer().min(1).default(30_000),
  OUTBOX_UNPUBLISHED_WARNING_MS: Joi.number().integer().min(1).default(60_000),
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
