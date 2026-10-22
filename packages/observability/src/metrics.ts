import {
  Counter,
  Gauge,
  Histogram,
  register as globalRegistry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import type { ServerResponse, IncomingMessage } from 'node:http';

export const METRICS_PREFIX = 'foc_';

let metricsInitialized = false;

/** Initialize default Prometheus metrics collection. Idempotent. */
export function initMetrics(): void {
  if (metricsInitialized) {
    return;
  }

  collectDefaultMetrics({ prefix: METRICS_PREFIX, register: globalRegistry });
  metricsInitialized = true;
}

/** Create an Express request handler that serves Prometheus metrics. */
export function createMetricsHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> {
  return async (_req, res) => {
    res.setHeader('Content-Type', globalRegistry.contentType);
    // return metrics handled by @prometheus-io/client
    res.end(await globalRegistry.metrics());
  };
}

/** Create a counter metric with optional labels. */
export function createLabeledCounter(
  name: string,
  help: string,
  labelNames: readonly string[],
): Counter<string> {
  return new Counter({
    name: `${METRICS_PREFIX}${name}`,
    help,
    labelNames,
    registers: [globalRegistry],
  });
}

export { globalRegistry as registry };
export type { Counter, Gauge, Histogram };
