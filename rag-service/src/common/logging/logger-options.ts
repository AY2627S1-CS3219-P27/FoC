import { pinoHttpOptions } from '@foc/observability';

/**
 * Request logging writes every header, and these hold login tokens that also
 * reveal the user's email. Logs are shipped to Loki, so they must never hold
 * them: logs identify a user by id only.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function loggerOptions(): ReturnType<typeof pinoHttpOptions> {
  return {
    ...pinoHttpOptions('rag-service'),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };
}
