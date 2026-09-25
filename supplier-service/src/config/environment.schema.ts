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

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: LogLevelName;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  DB_MIGRATIONS_RUN: boolean;
}

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
})
  .unknown(true)
  .prefs({ abortEarly: false, convert: true });

/**
 * Nest enables a log level together with every level more severe than it,
 * so LOG_LEVEL=warn yields ['fatal', 'error', 'warn'].
 */
export function logLevelsUpTo(level: LogLevelName): LogLevelName[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
}
