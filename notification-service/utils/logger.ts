import { createRequire } from 'node:module';
import type pino from 'pino';
import { envs } from './envs.ts';

// pino must be loaded through the CJS require path (createRequire), not an
// ESM import: PinoInstrumentation patches module loads via
// require-in-the-middle, which only sees require() calls. Under node's
// native TypeScript execution an ESM `import 'pino'` bypasses that patch, so
// pino records would never reach the OpenTelemetry logs pipeline (Loki).
const pinoFn = createRequire(import.meta.url)('pino') as typeof pino;

// zod already guarantees LOG_LEVEL is a supported pino value
export const logger = pinoFn({
  level: envs.LOG_LEVEL,
  base: { service: 'notification-service' },
});
