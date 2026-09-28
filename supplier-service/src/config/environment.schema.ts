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
  CAMPUS_MIN_LATITUDE: number;
  CAMPUS_MAX_LATITUDE: number;
  CAMPUS_MIN_LONGITUDE: number;
  CAMPUS_MAX_LONGITUDE: number;
  SEED_ON_STARTUP: boolean;
  SEED_CSV_PATH: string;
  JWT_PUBLIC_KEY_FILE: string;
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
