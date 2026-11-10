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
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_DATABASE: string;
  DB_PASSWORD_FILE: string;
  DB_MIGRATIONS_RUN: boolean;
  JWT_PUBLIC_KEY_FILE: string;
  OPENROUTER_API_KEY_FILE: string;
  OPENROUTER_BASE_URL: string;
  OPENROUTER_CHAT_MODEL: string;
  OPENROUTER_EMBEDDING_MODEL: string;
  SUPPORT_DOCS_PATH: string;
  INDEX_ON_STARTUP: boolean;
  RELEVANCE_CUTOFF: number;
  RATE_LIMIT_PER_MINUTE: number;
  CHAT_LOG_RETENTION_DAYS: number;
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
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string()
    .uri()
    .default('http://localhost:4318'),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_PASSWORD_FILE: Joi.string().min(1).required(),
  // Schema changes come only from migrations (synchronize is always off).
  // Applying pending migrations on boot keeps `docker compose up` one step.
  DB_MIGRATIONS_RUN: Joi.boolean().default(true),
  // user-service's JWT public key (PEM), used to verify access tokens.
  JWT_PUBLIC_KEY_FILE: Joi.string().min(1).required(),
  // The OpenRouter key is a Docker secret, read only when a call is made, so
  // the service still starts with CI's stub key.
  OPENROUTER_API_KEY_FILE: Joi.string().min(1).required(),
  OPENROUTER_BASE_URL: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .default('https://openrouter.ai/api/v1'),
  // A fixed model name, so evaluation results describe the model in use.
  OPENROUTER_CHAT_MODEL: Joi.string()
    .min(1)
    .default('anthropic/claude-haiku-5.5'),
  // Changing this means re-indexing: vectors from different models cannot be
  // compared, and the chunks table's column size is fixed to this model's.
  OPENROUTER_EMBEDDING_MODEL: Joi.string()
    .min(1)
    .default('openai/text-embedding-3-small'),
  // docs/support/, mounted read-only (see compose.yml).
  SUPPORT_DOCS_PATH: Joi.string().min(1).default('/support-docs'),
  // Bring the index up to date on startup when the documents have changed.
  // Checking costs nothing; re-indexing makes one small model call.
  INDEX_ON_STARTUP: Joi.boolean().default(true),
  // How similar a section must be to a question to count as relevant: 1 means
  // the same meaning. Below it, the bot says it cannot find the answer without
  // calling the chat model. Set from the evaluation results.
  RELEVANCE_CUTOFF: Joi.number().min(-1).max(1).default(0.3),
  // Every question costs money, so each user has a limit.
  RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(10),
  // Questions are personal data: chat_log rows are deleted after this long.
  CHAT_LOG_RETENTION_DAYS: Joi.number().integer().min(1).default(30),
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
