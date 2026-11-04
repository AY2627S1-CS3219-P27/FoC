import Joi from 'joi';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_LIFECYCLE_STREAMS,
  COMMS_RETRY_DELAYS_MS,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from '../messaging/rabbitmq-topology.js';

const [
  acceptedStream,
  deliveredStream,
  courierCancelledStream,
  cancelledStream,
] = COMMS_LIFECYCLE_STREAMS;

export interface EnvironmentVariables {
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
  RABBITMQ_USER: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  RABBITMQ_VHOST: string;
  RABBITMQ_PASSWORD_FILE: string;
  RABBITMQ_EXCHANGE: typeof COMMS_DOMAIN_EXCHANGE;
  RABBITMQ_ORDER_ERRAND_ACCEPTED_QUEUE: typeof acceptedStream.queue;
  RABBITMQ_ORDER_ERRAND_DELIVERED_QUEUE: typeof deliveredStream.queue;
  RABBITMQ_ORDER_COURIER_CANCELLED_QUEUE: typeof courierCancelledStream.queue;
  RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE: typeof cancelledStream.queue;
  RABBITMQ_RETRY_EXCHANGE: typeof COMMS_RETRY_EXCHANGE;
  RABBITMQ_RETRY_RETURN_EXCHANGE: typeof COMMS_RETRY_RETURN_EXCHANGE;
  RABBITMQ_DEAD_LETTER_EXCHANGE: typeof COMMS_DEAD_LETTER_EXCHANGE;
  RABBITMQ_RETRY_DELAYS_MS: number[];
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_USERNAME: string;
  REDIS_DB_INDEX: number;
  SOCKET_PATH: string;
  SOCKET_ALLOWED_ORIGINS: string[];
  SOCKET_TRANSPORT: 'websocket';
}

const origins = Joi.any()
  .default(['http://localhost:3000'])
  .custom((value: unknown, helpers) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return helpers.error('any.invalid');
    const parsed = value.split(',').map((origin) => origin.trim());
    if (parsed.some((origin) => origin.length === 0)) {
      return helpers.error('any.invalid');
    }
    return parsed;
  }, 'comma-separated socket origins')
  .custom((value: string[], helpers) => {
    if (
      value.length === 0 ||
      value.some((origin) => {
        try {
          const url = new URL(origin);
          return (
            url.origin !== origin || !['http:', 'https:'].includes(url.protocol)
          );
        } catch {
          return true;
        }
      })
    ) {
      return helpers.error('any.invalid');
    }
    return [...new Set(value)];
  }, 'absolute HTTP origins');

const retryDelays = Joi.any()
  .default([...COMMS_RETRY_DELAYS_MS])
  .custom((value: unknown, helpers) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return helpers.error('any.invalid');
    return value.split(',').map((delay) => Number(delay.trim()));
  }, 'comma-separated retry delays')
  .custom((value: number[], helpers) => {
    if (
      value.length !== COMMS_RETRY_DELAYS_MS.length ||
      value.some((delay, index) => delay !== COMMS_RETRY_DELAYS_MS[index])
    ) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'canonical retry delays');

export const environmentSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65_535).default(3000),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string()
    .uri()
    .default('http://localhost:4318'),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().integer().min(1).max(65_535).required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().integer().min(1).max(65_535).required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
  RABBITMQ_EXCHANGE: Joi.string()
    .valid(COMMS_DOMAIN_EXCHANGE)
    .default(COMMS_DOMAIN_EXCHANGE),
  RABBITMQ_ORDER_ERRAND_ACCEPTED_QUEUE: Joi.string()
    .valid(acceptedStream.queue)
    .default(acceptedStream.queue),
  RABBITMQ_ORDER_ERRAND_DELIVERED_QUEUE: Joi.string()
    .valid(deliveredStream.queue)
    .default(deliveredStream.queue),
  RABBITMQ_ORDER_COURIER_CANCELLED_QUEUE: Joi.string()
    .valid(courierCancelledStream.queue)
    .default(courierCancelledStream.queue),
  RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE: Joi.string()
    .valid(cancelledStream.queue)
    .default(cancelledStream.queue),
  RABBITMQ_RETRY_EXCHANGE: Joi.string()
    .valid(COMMS_RETRY_EXCHANGE)
    .default(COMMS_RETRY_EXCHANGE),
  RABBITMQ_RETRY_RETURN_EXCHANGE: Joi.string()
    .valid(COMMS_RETRY_RETURN_EXCHANGE)
    .default(COMMS_RETRY_RETURN_EXCHANGE),
  RABBITMQ_DEAD_LETTER_EXCHANGE: Joi.string()
    .valid(COMMS_DEAD_LETTER_EXCHANGE)
    .default(COMMS_DEAD_LETTER_EXCHANGE),
  RABBITMQ_RETRY_DELAYS_MS: retryDelays,
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().integer().min(1).max(65_535).required(),
  REDIS_USERNAME: Joi.string().min(1).default('default'),
  REDIS_DB_INDEX: Joi.number().integer().min(0).max(15).default(0),
  SOCKET_PATH: Joi.string()
    .pattern(/^\/[A-Za-z0-9/_.-]*$/)
    .default('/socket.io'),
  SOCKET_ALLOWED_ORIGINS: origins,
  SOCKET_TRANSPORT: Joi.string().valid('websocket').default('websocket'),
})
  .custom((environment: EnvironmentVariables, helpers) => {
    if (
      environment.NODE_ENV === 'production' &&
      environment.SOCKET_ALLOWED_ORIGINS.some(
        (origin) => new URL(origin).protocol !== 'https:',
      )
    ) {
      return helpers.error('any.invalid');
    }
    return environment;
  }, 'production socket origin security')
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
