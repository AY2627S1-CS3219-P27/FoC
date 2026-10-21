import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';

let sdk: NodeSDK | undefined;
let spanProcessor: BatchSpanProcessor | undefined;
let logProcessors: LogRecordProcessor[] = [];

export interface TelemetryOptions {
  serviceName: string;
  otlpEndpoint?: string;
  /**
   * OTLP/HTTP logs endpoint. Defaults to `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`;
   * when neither is set, log export is disabled.
   */
  otlpLogsEndpoint?: string;
  /** Test hook: replaces the OTLP logs processor when provided. */
  logRecordProcessors?: LogRecordProcessor[];
}

export interface Telemetry {
  /** Force-flush pending spans/logs. The SDK stays running. */
  flush(): Promise<void>;
  /** Force-flush, then gracefully stop the SDK. Safe to call repeatedly. */
  shutdown(): Promise<void>;
}

/**
 * Initialize OpenTelemetry tracing (and OTLP log export when a logs endpoint
 * is configured).
 * Must be called before NestFactory.create() to ensure instrumentation patches are applied first.
 */
export function initTelemetry(options: TelemetryOptions): Telemetry {
  if (sdk) {
    throw new Error('Telemetry is already initialized');
  }

  // NodeSDK has no forceFlush(), so hand it a span processor we own: flush()
  // below can force-flush it directly without stopping the SDK.
  spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter(
      options.otlpEndpoint ? { url: options.otlpEndpoint } : undefined,
    ),
  );

  // Logs are opt-in: without an endpoint the exporter would retry against
  // the default localhost receiver and spam export errors.
  const logsEndpoint =
    options.otlpLogsEndpoint ?? process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;

  logProcessors =
    options.logRecordProcessors ??
    (logsEndpoint
      ? [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter(
              options.otlpLogsEndpoint
                ? { url: options.otlpLogsEndpoint }
                : undefined,
            ),
          }),
        ]
      : []);

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    spanProcessors: [spanProcessor],
    logRecordProcessors: logProcessors.length > 0 ? logProcessors : undefined,
    instrumentations: [
      new ExpressInstrumentation(),
      new HttpInstrumentation(),
      new PgInstrumentation(),
      new AmqplibInstrumentation(),
      new RedisInstrumentation(),
      new NestInstrumentation(),
      new PinoInstrumentation(),
    ],
  });

  sdk.start();

  return {
    flush: async () => {
      try {
        await spanProcessor?.forceFlush();
        await Promise.all(logProcessors.map((p) => p.forceFlush()));
      } catch {
        // ignore
      }
    },
    shutdown: async () => {
      try {
        await sdk?.shutdown();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Flush and gracefully stop the SDK on SIGINT/SIGTERM so the final batch of
 * spans and logs is exported before the process exits. Nest's own
 * `enableShutdownHooks()` coexists with these handlers: every listener for a
 * signal runs, and the process only exits once the OTLP export has completed.
 *
 * Call once from the service's main.ts, right after `initTelemetry()`.
 */
export function registerTelemetryShutdown(telemetry: Telemetry): void {
  const onSignal = () => {
    // shutdown() swallows its own errors; the catch only guards against a
    // future implementation that rejects (an unhandled rejection would be
    // fatal during exit).
    void telemetry.shutdown().catch(() => undefined);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
