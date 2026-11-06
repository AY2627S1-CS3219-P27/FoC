import { EventEmitter } from 'node:events';
import { registry } from '@foc/observability';
import type { Request, Response } from 'express';
import { chatApiMetricsMiddleware, commsMetrics } from './comms-metrics.js';

describe('Communication Service metrics', () => {
  it('normalizes chat IDs and records the response status class', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111';
    const response = new EventEmitter() as Response & EventEmitter;
    response.statusCode = 404;
    const next = vi.fn();

    chatApiMetricsMiddleware(
      { path: `/v1/chats/${chatId}/messages` } as Request,
      response,
      next,
    );
    response.emit('finish');

    expect(next).toHaveBeenCalledOnce();
    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'foc_comms_http_requests_total{route="/v1/chats/:chatId/messages",status_class="4xx"}',
    );
    expect(metrics).not.toContain(chatId);
  });

  it('does not instrument unrelated endpoints', () => {
    const response = new EventEmitter() as Response & EventEmitter;
    const next = vi.fn();
    chatApiMetricsMiddleware(
      { path: '/health/live' } as Request,
      response,
      next,
    );
    expect(response.listenerCount('finish')).toBe(0);
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses only bounded socket operation and adapter labels', async () => {
    commsMetrics.socketHandshake('accepted');
    commsMetrics.socketConnected();
    commsMetrics.observeSocketOperation('send', 'idempotent', 0.01);
    commsMetrics.observeSocketOperation('read', 'noop', 0.02);
    commsMetrics.socketAdapterError('subscriber');
    commsMetrics.socketNotification('closing', 'emitted');
    commsMetrics.socketDisconnected();

    const metrics = await registry.metrics();
    expect(metrics).toContain(
      'foc_comms_socket_handshakes_total{outcome="accepted"}',
    );
    expect(metrics).toContain(
      'foc_comms_socket_operations_total{operation="send",outcome="idempotent"}',
    );
    expect(metrics).toContain(
      'foc_comms_socket_operations_total{operation="read",outcome="noop"}',
    );
    expect(metrics).toContain(
      'foc_comms_socket_adapter_errors_total{role="subscriber"}',
    );
    expect(metrics).toContain(
      'foc_comms_socket_notifications_total{event="closing",outcome="emitted"}',
    );
    expect(metrics).not.toMatch(/chat_id|user_id|message_id/);
  });
});
