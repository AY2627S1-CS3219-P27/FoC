import Joi from 'joi';

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
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().integer().min(1).max(65_535).required(),
  REDIS_USERNAME: Joi.string().min(1).default('default'),
  REDIS_DB_INDEX: Joi.number().integer().min(0).max(15).default(0),
  SOCKET_PATH: Joi.string()
    .pattern(/^\/[A-Za-z0-9/_-]*$/)
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
