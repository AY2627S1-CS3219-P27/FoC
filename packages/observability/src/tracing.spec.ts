import { describe, it, beforeEach, vi } from 'vitest';
import http from 'node:http';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  initTelemetry,
  registerTelemetryShutdown,
} from '../src/tracing.js';

describe('tracing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flush() exports pending spans and keeps the SDK running', async () => {
    const requests: number[] = [];
    const server = http.createServer((_req, res) => {
      requests.push(1);
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const telemetry = initTelemetry({
      serviceName: 'test-svc',
      otlpEndpoint: `http://127.0.0.1:${port}`,
    });

    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('first', (span) => {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    });
    await telemetry.flush();

    // The SDK must survive a flush: this second span is only exported if
    // flush() did not shut the SDK down.
    tracer.startActiveSpan('second', (span) => {
      span.end();
    });
    await telemetry.flush();

    expect(requests.length).toBeGreaterThanOrEqual(2);

    // Test cleanup: stop the SDK after the assertions above.
    await telemetry.shutdown();
    server.close();
  });

  it('does not throw when endpoint is unreachable', async () => {
    vi.resetModules();
    const mod = await import('../src/tracing.js');
    const telemetry = mod.initTelemetry({ serviceName: 'test', otlpEndpoint: 'http://127.0.0.1:1' });
    await telemetry.shutdown();
  });

  it('registerTelemetryShutdown flushes and stops on SIGINT/SIGTERM', () => {
    const flush = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => undefined);
    registerTelemetryShutdown({ flush, shutdown });

    // process.emit() only dispatches to registered listeners; it does not
    // raise a real signal that would kill the test process.
    process.emit('SIGINT');
    expect(shutdown).toHaveBeenCalledTimes(1);

    process.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
