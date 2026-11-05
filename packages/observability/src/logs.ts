import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { context, trace } from '@opentelemetry/api';
import type { LevelWithSilent } from 'pino';
import type { Options } from 'pino-http';

/** Nest level names (see the services' env schemas) → pino levels. */
const NEST_TO_PINO: Record<string, LevelWithSilent> = {
  fatal: 'fatal',
  error: 'error',
  warn: 'warn',
  log: 'info',
  info: 'info',
  debug: 'debug',
  verbose: 'trace',
  // Pino-native names pass through.
  trace: 'trace',
};

function resolveLevel(level?: string): LevelWithSilent {
  const requested = level ?? process.env.LOG_LEVEL ?? 'log';
  return NEST_TO_PINO[requested] ?? 'info';
}

/**
 * pino-http options for the service logger, shared by all services via
 * `LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('<service>') })`.
 *
 * Shipping to Loki is handled by `PinoInstrumentation` (registered by
 * `initTelemetry`): every pino record goes to the OpenTelemetry SDK and is
 * exported as OTLP logs with the active span's trace/span IDs attached.
 */
export function pinoHttpOptions(serviceName: string): Options {
  const options: Options = {
    name: serviceName,
    level: resolveLevel(process.env.LOG_LEVEL),
    // Reuse the active trace id as the request id while a request span is
    // active, so `req.id` matches the trace in Tempo.
    genReqId: () => {
      const spanContext = trace.getSpan(context.active())?.spanContext();
      return spanContext?.traceId ?? randomUUID();
    },
  };

  // JSON in production; pino-pretty for readable dev consoles. Resolved from
  // this package's own dependencies so services don't need pino-pretty.
  if (process.env.NODE_ENV !== 'production') {
    options.transport = {
      target: createRequire(import.meta.url).resolve('pino-pretty'),
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:HH:MM:ss',
      },
    };
  }

  return options;
}
