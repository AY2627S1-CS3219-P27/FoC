import Joi from 'joi';
import {
  CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
  CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
  CREDIT_RESERVATION_V1_ROUTING_KEY,
  CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
  CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
  CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
  CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  USER_REGISTERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import {
  outboxEnvironmentKeys,
  validateOutboxTiming,
  type OutboxEnvironmentVariables,
} from '@foc/outbox';

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const USER_REGISTERED_QUEUE = 'credit-service.user-registered.v1';
const CREDIT_RESERVATION_QUEUE = 'credit-service.credit-reservation.v1';
const CREDIT_RESERVATION_ADJUSTMENT_QUEUE =
  'credit-service.credit-reservation-adjustment.v1';
const ORDER_ERRAND_COMPLETED_QUEUE = 'credit-service.order-errand-completed.v1';
const ORDER_ERRAND_CANCELLED_QUEUE = 'credit-service.order-errand-cancelled.v1';

export interface EnvironmentVariables extends OutboxEnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
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
  RABBITMQ_ORDER_ERRAND_COMPLETED_QUEUE: string;
  RABBITMQ_ORDER_ERRAND_COMPLETED_ROUTING_KEY: typeof ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY;
  RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE: string;
  RABBITMQ_ORDER_ERRAND_CANCELLED_ROUTING_KEY: typeof ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_TRANSFER_SUCCEEDED_ROUTING_KEY: typeof CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_TRANSFER_REJECTED_ROUTING_KEY: typeof CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RELEASE_SUCCESS_ROUTING_KEY: typeof CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY;
  RABBITMQ_CREDIT_RELEASE_REJECTED_ROUTING_KEY: typeof CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY;
  RABBITMQ_RETRY_EXCHANGE: string;
  RABBITMQ_RETRY_RETURN_EXCHANGE: string;
  RABBITMQ_DEAD_LETTER_EXCHANGE: string;
  RABBITMQ_PREFETCH: number;
  RABBITMQ_RETRY_DELAYS_MS: number[];
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
    .valid('debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().default('http://localhost:4318'),
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
  RABBITMQ_ORDER_ERRAND_COMPLETED_QUEUE: Joi.string()
    .min(1)
    .default(ORDER_ERRAND_COMPLETED_QUEUE)
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.valid(ORDER_ERRAND_COMPLETED_QUEUE),
    }),
  RABBITMQ_ORDER_ERRAND_COMPLETED_ROUTING_KEY: Joi.string()
    .valid(ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY)
    .default(ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY),
  RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE: Joi.string()
    .min(1)
    .default(ORDER_ERRAND_CANCELLED_QUEUE)
    .when('NODE_ENV', {
      is: 'test',
      otherwise: Joi.valid(ORDER_ERRAND_CANCELLED_QUEUE),
    }),
  RABBITMQ_ORDER_ERRAND_CANCELLED_ROUTING_KEY: Joi.string()
    .valid(ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY)
    .default(ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_TRANSFER_SUCCEEDED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY)
    .default(CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_TRANSFER_REJECTED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY)
    .default(CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RELEASE_SUCCESS_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY)
    .default(CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY),
  RABBITMQ_CREDIT_RELEASE_REJECTED_ROUTING_KEY: Joi.string()
    .valid(CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY)
    .default(CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY),
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.credit.retry'),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string()
    .min(1)
    .default('foc.credit.back'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string().min(1).default('foc.credit.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,
  ...outboxEnvironmentKeys,
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
  .custom(validateOutboxTiming, 'outbox timing relationships')
  .custom((environment: EnvironmentVariables, helpers) => {
    if (
      environment.CREDIT_OPERATION_MAX_BACKOFF_MS <
      environment.CREDIT_OPERATION_POLL_INTERVAL_MS
    ) {
      return helpers.error('any.invalid');
    }
    return environment;
  }, 'credit operation timing relationships')
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
