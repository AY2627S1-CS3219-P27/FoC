import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  initTelemetry,
  registerShutdown,
} from '../src/tracing.js';

describe('tracing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('registerShutdown closes the app, flushes and stops the SDK, then exits 0', async () => {
    const calls: string[] = [];
    const close = vi.fn(async () => void calls.push('close'));
    const shutdown = vi.fn(async () => void calls.push('shutdown'));
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    registerShutdown({ close }, { flush: async () => undefined, shutdown });

    // process.emit() only dispatches to registered listeners; it does not
    // raise a real signal that would kill the test process.
    process.emit('SIGINT');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(calls).toEqual(['close', 'shutdown']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('registerShutdown ignores a second signal while shutting down', async () => {
    const close = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => undefined);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    registerShutdown({ close }, { flush: async () => undefined, shutdown });

    process.emit('SIGINT');
    process.emit('SIGTERM');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(close).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('registerShutdown exits 1 when closing the app fails, but still flushes', async () => {
    const close = vi.fn(async () => {
      throw new Error('hook boom');
    });
    const shutdown = vi.fn(async () => undefined);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerShutdown({ close }, { flush: async () => undefined, shutdown });

    process.emit('SIGTERM');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(error).toHaveBeenCalled();
  });
});
