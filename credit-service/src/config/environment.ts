import Joi from 'joi';
import {
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
  CREDIT_RESERVATION_V1_ROUTING_KEY,
  USER_REGISTERED_V1_ROUTING_KEY,
} from '@foc/contracts';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const USER_REGISTERED_QUEUE = 'credit-service.user-registered.v1';
const CREDIT_RESERVATION_QUEUE = 'credit-service.credit-reservation.v1';
const CREDIT_RESERVATION_ADJUSTMENT_QUEUE =
  'credit-service.credit-reservation-adjustment.v1';
const MIN_OUTBOX_COMPLETION_MARGIN_MS = 5_000;

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  JWT_PUBLIC_KEY_FILE: string;
  INITIAL_CREDIT_BALANCE: number;
  RABBITMQ_USER: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  RABBITMQ_VHOST: string;
  RABBITMQ_PASSWORD_FILE: string;
  RABBITMQ_EXCHANGE: string;
  RABBITMQ_USER_REGISTERED_QUEUE: string;
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: typeof USER_REGISTERED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: typeof CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_QUEUE: string;
  RABBITMQ_CREDIT_RESERVATION_ROUTING_KEY: typeof CREDIT_RESERVATION_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_QUEUE: string;
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_ROUTING_KEY: typeof CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_SUCCESS_ROUTING_KEY: typeof CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_REJECTED_ROUTING_KEY: typeof CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY: typeof CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY: typeof CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY;
  RABBITMQ_RETRY_EXCHANGE: string;
  RABBITMQ_RETRY_RETURN_EXCHANGE: string;
  RABBITMQ_DEAD_LETTER_EXCHANGE: string;
  RABBITMQ_PREFETCH: number;
  RABBITMQ_RETRY_DELAYS_MS: number[];
  OUTBOX_POLL_INTERVAL_MS: number;
  OUTBOX_BATCH_SIZE: number;
  OUTBOX_CONFIRM_TIMEOUT_MS: number;
  OUTBOX_CLAIM_LEASE_MS: number;
  OUTBOX_RETRY_BASE_DELAY_MS: number;
  OUTBOX_RETRY_MAX_DELAY_MS: number;
  OUTBOX_UNPUBLISHED_WARNING_MS: number;
  CREDIT_OPERATION_CLAIM_LEASE_MS: number;
  CREDIT_OPERATION_POLL_INTERVAL_MS: number;
  CREDIT_OPERATION_MAX_BACKOFF_MS: number;
  CREDIT_OPERATION_STUCK_AFTER_MS: number;
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
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),
  INITIAL_CREDIT_BALANCE: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(100),
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().integer().min(1).max(65_535).required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_EXCHANGE: Joi.string().min(1).default('foc.events'),
  RABBITMQ_USER_REGISTERED_QUEUE: Joi.string()
    .min(1)
    .default(USER_REGISTERED_QUEUE)
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.valid(USER_REGISTERED_QUEUE),
    }),
  RABBITMQ_USER_REGISTERED_ROUTING_KEY: Joi.string()
    .valid(USER_REGISTERED_V1_ROUTING_KEY)
    .default(USER_REGISTERED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY)
    .default(CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_QUEUE: Joi.string()
    .min(1)
    .default(CREDIT_RESERVATION_QUEUE)
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.valid(CREDIT_RESERVATION_QUEUE),
    }),
  RABBITMQ_CREDIT_RESERVATION_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_QUEUE: Joi.string()
    .min(1)
    .default(CREDIT_RESERVATION_ADJUSTMENT_QUEUE)
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.valid(CREDIT_RESERVATION_ADJUSTMENT_QUEUE),
    }),
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_SUCCESS_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_REJECTED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_REJECTED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY)
    .default(CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY),
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.credit.retry'),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string()
    .min(1)
    .default('foc.credit.back'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string().min(1).default('foc.credit.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(1).default(1_000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).default(100),
  OUTBOX_CONFIRM_TIMEOUT_MS: Joi.number().integer().min(1).default(20_000),
  OUTBOX_CLAIM_LEASE_MS: Joi.number().integer().min(1).default(30_000),
  OUTBOX_RETRY_BASE_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(1_000),
  OUTBOX_RETRY_MAX_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(60_000),
  OUTBOX_UNPUBLISHED_WARNING_MS: Joi.number().integer().min(1).default(60_000),
  CREDIT_OPERATION_CLAIM_LEASE_MS: Joi.number()
    .integer()
    .min(1)
    .default(30_000),
  CREDIT_OPERATION_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(1)
    .default(1_000),
  CREDIT_OPERATION_MAX_BACKOFF_MS: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(60_000),
  CREDIT_OPERATION_STUCK_AFTER_MS: Joi.number()
    .integer()
    .min(1)
    .default(60_000),
})
  .custom((environment: EnvironmentVariables, helpers) => {
    const completionMargin =
      environment.OUTBOX_CLAIM_LEASE_MS - environment.OUTBOX_CONFIRM_TIMEOUT_MS;
    if (completionMargin < MIN_OUTBOX_COMPLETION_MARGIN_MS) {
      return helpers.error('any.invalid');
    }
    if (
      environment.OUTBOX_RETRY_MAX_DELAY_MS <
      environment.OUTBOX_RETRY_BASE_DELAY_MS
    ) {
      return helpers.error('any.invalid');
    }
    if (
      environment.CREDIT_OPERATION_MAX_BACKOFF_MS <
      environment.CREDIT_OPERATION_POLL_INTERVAL_MS
    ) {
      return helpers.error('any.invalid');
    }
    return environment;
  }, 'worker timing relationships')
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
