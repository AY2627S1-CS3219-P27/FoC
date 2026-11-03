import Fastify from 'fastify';
import { logger } from '../utils/logger.ts';

/**
 * Builds the HTTP surface. The scaffold exposes only the liveness probe the
 * container healthcheck hits; the subscription endpoints (register, delete,
 * rotate, with access-token validation) are registered here as they are
 * implemented.
 */
export function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
