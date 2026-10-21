export type {
  Counter,
  Gauge,
  Histogram,
} from '@prometheus-io/client';
export {
  initTelemetry,
  registerShutdown,
  type TelemetryOptions,
  type Telemetry,
} from './tracing.js';
export {
  initMetrics,
  createMetricsHandler,
  createLabeledCounter,
  registry,
  METRICS_PREFIX,
} from './metrics.js';
export {
  annotateConsumeSpan,
  MESSAGE_RETRY_COUNT_ATTRIBUTE,
  type ConsumeSpanAttributes,
} from './messaging.js';
export {
  pinoHttpOptions,
} from './logs.js';
