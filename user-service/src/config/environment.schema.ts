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
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_USERNAME: Joi.string().min(1).required(),
  REDIS_DB_INDEX: Joi.number().min(0).required(),
  SERVER_SECRET_FILE: Joi.string().min(1).required(),
  RABBITMQ_USER: Joi.string().min(1).required(),
  RABBITMQ_HOST: Joi.string().hostname().required(),
  RABBITMQ_PORT: Joi.number().port().required(),
  RABBITMQ_VHOST: Joi.string().min(1).required(),
  RABBITMQ_PASSWORD_FILE: Joi.string().min(1).required(),
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });
