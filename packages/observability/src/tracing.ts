import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';

let sdk: NodeSDK | undefined;
let exporter: OTLPTraceExporter | undefined;

export interface TelemetryOptions {
  serviceName: string;
  otlpEndpoint?: string;
}

export interface Telemetry {
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Initialize OpenTelemetry tracing.
 * Must be called before NestFactory.create() to ensure instrumentation patches are applied first.
 */
export function initTelemetry(options: TelemetryOptions): Telemetry {
  if (sdk) {
    throw new Error('Telemetry is already initialized');
  }

  exporter = new OTLPTraceExporter(
    options.otlpEndpoint ? { url: options.otlpEndpoint } : undefined,
  );

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    traceExporter: exporter,
    instrumentations: [
      new ExpressInstrumentation(),
      new HttpInstrumentation(),
      new PgInstrumentation(),
      new AmqplibInstrumentation(),
      new RedisInstrumentation(),
      new NestInstrumentation(),
    ],
  });

  sdk.start();

  return {
    flush: async () => {
      try {
        await sdk?.shutdown();
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
