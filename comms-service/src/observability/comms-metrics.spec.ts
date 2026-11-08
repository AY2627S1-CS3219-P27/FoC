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

  it.each([
    ['/v1/chats/archives', '/v1/chats/archives'],
    [
      '/v1/chats/archives/22222222-2222-4222-8222-222222222222',
      '/v1/chats/archives/:archiveId',
    ],
  ])('normalizes archive route %s', async (path, route) => {
    const response = new EventEmitter() as Response & EventEmitter;
    response.statusCode = 200;
    const next = vi.fn();

    chatApiMetricsMiddleware({ path } as Request, response, next);
    response.emit('finish');

    const metrics = await registry.metrics();
    expect(metrics).toContain(
      `foc_comms_http_requests_total{route="${route}",status_class="2xx"}`,
    );
    expect(metrics).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('uses only bounded socket operation and adapter labels', async () => {
    commsMetrics.socketHandshake('accepted');
    commsMetrics.socketConnected();
    commsMetrics.observeSocketOperation('send', 'idempotent', 0.01);
    commsMetrics.observeSocketOperation('read', 'noop', 0.02);
    commsMetrics.socketAdapterError('subscriber');
    commsMetrics.socketNotification('closing', 'emitted');
    commsMetrics.socketNotification('archived', 'failed');
    commsMetrics.deadlineTransition('ERRAND_DELIVERED');
    commsMetrics.archiveClaim('reclaimed');
    commsMetrics.observeArchiveClaim('successful', 0.01);
    commsMetrics.archiveClaimsInFlight(2);
    commsMetrics.observeArchive('archived', 0.05);
    commsMetrics.archiveShutdown('timed_out');
    commsMetrics.archiveClaimsInFlight(0);
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
    expect(metrics).toContain(
      'foc_comms_socket_notifications_total{event="archived",outcome="failed"}',
    );
    expect(metrics).toContain(
      'foc_comms_deadline_transitions_total{reason="ERRAND_DELIVERED"}',
    );
    expect(metrics).toContain(
      'foc_comms_archive_claims_total{outcome="reclaimed"}',
    );
    expect(metrics).toContain(
      'foc_comms_archive_operations_total{outcome="archived"}',
    );
    expect(metrics).toContain(
      'foc_comms_archive_claim_duration_seconds_count{outcome="successful"}',
    );
    expect(metrics).toContain('foc_comms_archive_claims_in_flight 0');
    expect(metrics).toContain(
      'foc_comms_archive_shutdown_total{outcome="timed_out"}',
    );
    expect(metrics).not.toMatch(
      /chat_id|user_id|message_id|archive_id|event_id|claim_token/,
    );
  });
});
