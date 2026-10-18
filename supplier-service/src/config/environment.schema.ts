import {
  outboxEnvironmentKeys,
  validateOutboxTiming,
  type OutboxEnvironmentVariables,
} from '@foc/outbox';
import {
  ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
  SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
} from '@foc/contracts';
import Joi from 'joi';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;

export type LogLevelName = (typeof LOG_LEVELS)[number];

export interface EnvironmentVariables extends OutboxEnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: LogLevelName;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  DB_MIGRATIONS_RUN: boolean;
  CAMPUS_MIN_LATITUDE: number;
  CAMPUS_MAX_LATITUDE: number;
  CAMPUS_MIN_LONGITUDE: number;
  CAMPUS_MAX_LONGITUDE: number;
  SEED_ON_STARTUP: boolean;
  SEED_CSV_PATH: string;
  JWT_PUBLIC_KEY_FILE: string;
  PLACEHOLDER_IMAGE_URL: string;
  RABBITMQ_USER: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  RABBITMQ_VHOST: string;
  RABBITMQ_PASSWORD_FILE: string;
  RABBITMQ_EXCHANGE: string;
  RABBITMQ_RETRY_EXCHANGE: string;
  RABBITMQ_RETRY_RETURN_EXCHANGE: string;
  RABBITMQ_DEAD_LETTER_EXCHANGE: string;
  RABBITMQ_PREFETCH: number;
  RABBITMQ_RETRY_DELAYS_MS: number[];
  RABBITMQ_SUPPLIER_VALIDATION_QUEUE: string;
  RABBITMQ_SUPPLIER_VALIDATION_REQUESTED_ROUTING_KEY: typeof ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY;
  RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY: typeof SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * Five strictly increasing delays, one per retry before a message is
 * dead-lettered (F15.7.5), as in credit-service.
 */
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
 * All env vars the service reads are validated here: an invalid setup fails
 * fast with the offending keys reported together, instead of surfacing as
 * confusing errors later at the point of use.
 */
export const environmentSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('log'),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  // Schema changes come only from migrations (synchronize is always off).
  // Applying pending migrations on boot keeps `docker compose up` one step.
  DB_MIGRATIONS_RUN: Joi.boolean().default(true),
  // The NUS campus bounding box every supplier's coordinates must lie in
  // (F1.2.7). The defaults cover the seed data with a small margin.
  CAMPUS_MIN_LATITUDE: Joi.number().min(-90).max(90).default(1.28),
  CAMPUS_MAX_LATITUDE: Joi.number()
    .max(90)
    .greater(Joi.ref('CAMPUS_MIN_LATITUDE'))
    .default(1.31),
  CAMPUS_MIN_LONGITUDE: Joi.number().min(-180).max(180).default(103.74),
  CAMPUS_MAX_LONGITUDE: Joi.number()
    .max(180)
    .greater(Joi.ref('CAMPUS_MIN_LONGITUDE'))
    .default(103.79),
  // Import the template's supplier seed file on startup (F12). Re-running is
  // safe: suppliers already present are skipped.
  SEED_ON_STARTUP: Joi.boolean().default(true),
  SEED_CSV_PATH: Joi.string()
    .min(1)
    .default('/seed-data/supplier-seed-data.csv'),
  // user-service's JWT public key (PEM), used to verify access tokens.
  // Required, as in user-service: without it no request can be authenticated.
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),
  // Image returned for suppliers without a photo (F1.2.9). Blank until images
  // are hosted (step 19): suppliers without a photo then return null.
  PLACEHOLDER_IMAGE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  // RabbitMQ, for Order Service's supplier-validation requests (F15.7). The
  // connection comes from env/shared.env; the login is this service's own
  // broker user (F13.7). The password is read from the file only on connect.
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().integer().min(1).max(65_535).required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_EXCHANGE: Joi.string().min(1).default('foc.events'),
  // This service's own retry, return and dead-letter exchanges, named like
  // credit-service's (foc.credit.*) and order-service's (foc.order.*).
  RABBITMQ_RETRY_EXCHANGE: Joi.string().min(1).default('foc.supplier.retry'),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string()
    .min(1)
    .default('foc.supplier.back'),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string()
    .min(1)
    .default('foc.supplier.dlx'),
  RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(10),
  RABBITMQ_RETRY_DELAYS_MS: retryDelaysSchema,
  // Order Service's supplier-validation requests, and our replies (F15.7).
  // The routing keys are pinned to the shared contracts, as in credit-service.
  RABBITMQ_SUPPLIER_VALIDATION_QUEUE: Joi.string()
    .min(1)
    .default('supplier-service.order-supplier-validation-requested.v1'),
  RABBITMQ_SUPPLIER_VALIDATION_REQUESTED_ROUTING_KEY: Joi.string()
    .valid(ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY)
    .default(ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY),
  RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY: Joi.string()
    .valid(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY)
    .default(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY),
  // The transactional outbox that publishes replies (F15.7.3).
  ...outboxEnvironmentKeys,
})
  .unknown(true)
  // Checked on the whole object, after defaults are applied: setting only a
  // minimum above the default maximum would otherwise pass.
  .custom((env: EnvironmentVariables, helpers) => {
    const invalid = [
      ['CAMPUS_MIN_LATITUDE', 'CAMPUS_MAX_LATITUDE'],
      ['CAMPUS_MIN_LONGITUDE', 'CAMPUS_MAX_LONGITUDE'],
    ] as const;
    for (const [min, max] of invalid) {
      if (env[min] >= env[max]) {
        return helpers.message({
          custom: `${min} (${env[min]}) must be below ${max} (${env[max]})`,
        });
      }
    }
    return env;
  })
  .custom(validateOutboxTiming, 'outbox timing relationships')
  .prefs({ abortEarly: false, convert: true });

/**
 * Nest enables a log level together with every level more severe than it,
 * so LOG_LEVEL=warn yields ['fatal', 'error', 'warn'].
 */
export function logLevelsUpTo(level: LogLevelName): LogLevelName[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
}
