import { pino } from 'pino';
import { envs } from './validator.ts';

// zod already guarantees LOG_LEVEL is a supported pino value
export const logger = pino({
  level: envs.LOG_LEVEL,
  base: { service: 'email-service' },
});
