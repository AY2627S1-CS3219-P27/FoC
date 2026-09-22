import { pino } from 'pino';
import { envs } from './validator.ts';

const LOG_LEVEL_ALIASES: Record<string, string> = {
  log: 'info',
  verbose: 'debug',
};

// zod already guarantees LOG_LEVEL is one of the documented values.
const resolvedLevel = LOG_LEVEL_ALIASES[envs.LOG_LEVEL] ?? envs.LOG_LEVEL;

export const logger = pino({
  level: resolvedLevel,
  base: { service: 'email-service' },
});
