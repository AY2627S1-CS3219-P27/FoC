import Joi from 'joi';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

// "1000,2000,..." -> five strictly increasing positive delays (the transport has five retry queues).
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

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),

  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),

  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().port().required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_EXCHANGE: Joi.string().min(1).default('foc.events'),
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.order.retry'),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string().min(1).default('foc.order.back'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string().min(1).default('foc.order.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,

  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).default(100),
  OUTBOX_CONFIRM_TIMEOUT_MS: Joi.number().integer().min(1).default(20_000),
  OUTBOX_CLAIM_LEASE_MS: Joi.number().integer().min(1).default(30_000),
  OUTBOX_RETRY_BASE_DELAY_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_RETRY_MAX_DELAY_MS: Joi.number().integer().min(1).default(60_000),
  OUTBOX_UNPUBLISHED_WARNING_MS: Joi.number().integer().min(1).default(60_000),

  SWEEP_INTERVAL_MS: Joi.number().integer().min(1).default(60_000),
  RESERVING_CREDIT_TIMEOUT_MS: Joi.number().integer().min(1).default(300_000),
  CREDIT_REPLY_TIMEOUT_MS: Joi.number().integer().min(1).default(120_000),
  CREDIT_RESEND_MAX: Joi.number().integer().min(0).default(3),
})
  // The lease must outlast the confirm timeout, or a slow publish loses its claim.
  .custom((env, helpers) => {
    if (
      env.OUTBOX_CLAIM_LEASE_MS - env.OUTBOX_CONFIRM_TIMEOUT_MS < 5_000 ||
      env.OUTBOX_RETRY_MAX_DELAY_MS < env.OUTBOX_RETRY_BASE_DELAY_MS
    ) {
      return helpers.error('any.invalid');
    }
    return env;
  }, 'outbox timing relationships')
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
