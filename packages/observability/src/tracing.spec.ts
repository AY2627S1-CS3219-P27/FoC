import { describe, it, beforeEach } from 'vitest';
import http from 'node:http';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { initTelemetry } from '../src/tracing.js';

describe('tracing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('can initialize telemetry once', async () => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(200);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const telemetry = initTelemetry({ serviceName: 'test-svc', otlpEndpoint: `http://127.0.0.1:${port}` });

    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('op', (span) => {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    });

    await telemetry.flush();

    server.close();
  });

  it('does not throw when endpoint is unreachable', async () => {
    vi.resetModules();
    const mod = await import('../src/tracing.js');
    const telemetry = mod.initTelemetry({ serviceName: 'test', otlpEndpoint: 'http://127.0.0.1:1' });
    await telemetry.shutdown();
  });
});
