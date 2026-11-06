import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerResponse, IncomingMessage } from 'node:http';
import {
  initMetrics,
  createMetricsHandler,
  createLabeledCounter,
  createLabeledHistogram,
  METRICS_PREFIX,
} from '../src/metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a metrics handler that serves Prometheus format', async () => {
    initMetrics();
    const handler = createMetricsHandler();
    const mockReq = {} as IncomingMessage;
    let body = '';
    let contentType = '';

    const mockRes = {
      setHeader: (name: string, value: string) => {
        contentType = value;
      },
      end: (data: string) => {
        body = data;
      },
    } as unknown as ServerResponse;

    await handler(mockReq, mockRes);

    expect(contentType).toContain('text/plain');
    expect(body).toContain('foc_process_cpu_user_seconds_total');
  });

  it('creates a labeled counter', async () => {
    initMetrics();
    const counter = createLabeledCounter('test_counter', 'help', ['route']);

    counter.inc({ route: '/x' });

    const handler = createMetricsHandler();
    const mockReq = {} as IncomingMessage;
    let body = '';

    const mockRes = {
      setHeader: () => {},
      end: (data: string) => {
        body = data;
      },
    } as unknown as ServerResponse;

    await handler(mockReq, mockRes);

    expect(body).toContain('foc_test_counter{route="/x"} 1');
  });

  it('uses the correct metrics prefix', () => {
    expect(METRICS_PREFIX).toBe('foc_');
  });

  it('creates labeled histograms with explicit buckets', async () => {
    const histogram = createLabeledHistogram(
      'test_duration_seconds',
      'test duration',
      ['route'],
      [0.1, 1],
    );
    histogram.observe({ route: '/test' }, 0.5);

    const handler = createMetricsHandler();
    const chunks: string[] = [];
    const response = {
      setHeader: vi.fn(),
      end: vi.fn((chunk: string) => chunks.push(chunk)),
    };
    await handler({} as never, response as never);
    expect(chunks.join('')).toContain(
      'foc_test_duration_seconds_bucket{le="1",route="/test"} 1',
    );
  });
});
