import Fastify from 'fastify';
import { createMetricsHandler, initMetrics } from '@foc/observability';
import { logger } from '../utils/logger.ts';

/**
 * Builds the HTTP surface. The scaffold exposes the liveness probe the
 * container healthcheck hits and the Prometheus scrape endpoint; the
 * subscription endpoints (register, delete, rotate, with access-token
 * validation) are registered here as they are implemented.
 */
export function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async () => ({ status: 'ok' }));

  // Prometheus scrape endpoint. initMetrics is idempotent, so building the
  // server is enough to have the default (foc_-prefixed) metrics registered.
  initMetrics();
  const metricsHandler = createMetricsHandler();
  app.get('/metrics', async (req, reply) => {
    reply.hijack();
    await metricsHandler(req.raw, reply.raw);
  });

  return app;
}
