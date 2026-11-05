import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type {
  LogRecordProcessor,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { pinoHttpOptions as pinoHttpOptionsType } from '../src/logs.js';
import type { initTelemetry as initTelemetryType } from '../src/tracing.js';

type Record_ = Record<string, unknown>;

function captureLines() {
  const lines: Record_[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)) as Record_);
      callback();
    },
  });
  return { destination, lines };
}

async function freshModules() {
  vi.resetModules();
  return {
    pinoHttpOptions: (await import('../src/logs.js'))
      .pinoHttpOptions as typeof pinoHttpOptionsType,
    initTelemetry: (await import('../src/tracing.js'))
      .initTelemetry as typeof initTelemetryType,
  };
}

describe('logs', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    trace.disable();
    context.disable();
  });

  it('maps LOG_LEVEL to the pino level', async () => {
    const { pinoHttpOptions } = await freshModules();

    vi.stubEnv('LOG_LEVEL', 'verbose');
    expect(pinoHttpOptions('test-svc').level).toBe('trace');

    vi.stubEnv('LOG_LEVEL', 'log');
    expect(pinoHttpOptions('test-svc').level).toBe('info');

    vi.stubEnv('LOG_LEVEL', 'warn');
    expect(pinoHttpOptions('test-svc').level).toBe('warn');
  });

  it('names the logger and uses pino-pretty outside production', async () => {
    const { pinoHttpOptions } = await freshModules();

    const dev = pinoHttpOptions('test-svc');
    expect(dev.name).toBe('test-svc');
    const transport = dev.transport as { target?: unknown } | undefined;
    expect(String(transport?.target)).toContain('pino-pretty');

    vi.stubEnv('NODE_ENV', 'production');
    const prod = pinoHttpOptions('test-svc');
    expect(prod.transport).toBeUndefined();
  });

  it('reuses the active trace id as the request id', async () => {
    const { pinoHttpOptions } = await freshModules();
    const { genReqId } = pinoHttpOptions('test-svc');
    const generate = genReqId as () => string;

    const outside = generate();
    expect(outside).toMatch(/^[0-9a-f-]{36}$/);

    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
    trace.setGlobalTracerProvider(new BasicTracerProvider());

    trace.getTracer('test').startActiveSpan('op', (span) => {
      expect(generate()).toBe(span.spanContext().traceId);
      span.end();
    });
  });

  it('ships pino records to the SDK with the active trace context', async () => {
    const { initTelemetry } = await freshModules();

    // A synchronous processor: onEmit fires during Logger.emit, so no async
    // export machinery is involved in the assertions below.
    const records: ReadableLogRecord[] = [];
    const collector: LogRecordProcessor = {
      onEmit(record) {
        records.push(record);
      },
      async forceFlush() {},
      async shutdown() {},
    };
    initTelemetry({
      serviceName: 'test-svc',
      logRecordProcessors: [collector],
    });

    const destination = captureLines();
    const pino = (await import('node:module')).createRequire(import.meta.url)(
      'pino',
    );
    const logger = pino({ level: 'trace' }, destination.destination);

    let traceId: string | undefined;
    trace.getTracer('test').startActiveSpan('op', (span) => {
      traceId = span.spanContext().traceId;
      logger.info({ context: 'Bootstrap' }, 'inside the span');
      span.end();
    });

    expect(records).toHaveLength(1);
    expect(records[0].body).toBe('inside the span');
    expect(records[0].attributes).toMatchObject({ context: 'Bootstrap' });
    expect(records[0].spanContext?.traceId).toBe(traceId);
    // No SDK shutdown here: under vitest NodeSDK.shutdown hangs on the
    // registered require hook (it completes fine under plain node), and the
    // services never call it anyway.
  });
});
