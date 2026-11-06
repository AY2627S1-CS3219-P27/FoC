import {
  createLabeledCounter,
  createLabeledGauge,
  createLabeledHistogram,
} from '@foc/observability';
import type { RequestHandler } from 'express';

export type LifecycleDeliveryOutcome =
  | 'successful'
  | 'duplicate'
  | 'skipped'
  | 'retried'
  | 'dead_lettered'
  | 'conflicting';

export type SocketOperation = 'join' | 'send' | 'read';
export type SocketOperationOutcome =
  | 'successful'
  | 'idempotent'
  | 'noop'
  | 'unauthenticated'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'archived'
  | 'conflict'
  | 'internal';

const deliveryCounter = createLabeledCounter(
  'comms_lifecycle_deliveries_total',
  'Communication lifecycle deliveries by stream and terminal transport outcome.',
  ['stream', 'outcome'],
);
const handlerDuration = createLabeledHistogram(
  'comms_lifecycle_handler_duration_seconds',
  'Communication lifecycle application handler latency.',
  ['stream', 'outcome'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);
const chatCreatedCounter = createLabeledCounter(
  'comms_chats_created_total',
  'Chats created from committed accepted lifecycle events.',
  ['source'],
);
const apiCounter = createLabeledCounter(
  'comms_http_requests_total',
  'Communication chat API requests by normalized route and status class.',
  ['route', 'status_class'],
);
const apiDuration = createLabeledHistogram(
  'comms_http_request_duration_seconds',
  'Communication chat API latency by normalized route and status class.',
  ['route', 'status_class'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);
const socketHandshakeCounter = createLabeledCounter(
  'comms_socket_handshakes_total',
  'Socket handshakes by authentication outcome.',
  ['outcome'],
);
const activeSocketGauge = createLabeledGauge(
  'comms_socket_active',
  'Currently connected authenticated chat sockets.',
  [],
);
const socketOperationCounter = createLabeledCounter(
  'comms_socket_operations_total',
  'Acknowledged chat socket operations by bounded outcome.',
  ['operation', 'outcome'],
);
const socketOperationDuration = createLabeledHistogram(
  'comms_socket_operation_duration_seconds',
  'Acknowledged chat socket operation latency by bounded outcome.',
  ['operation', 'outcome'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
);
const socketAdapterErrorCounter = createLabeledCounter(
  'comms_socket_adapter_errors_total',
  'Socket Redis adapter connection errors by connection role.',
  ['role'],
);
const socketNotificationCounter = createLabeledCounter(
  'comms_socket_notifications_total',
  'Post-commit chat lifecycle socket notifications by bounded event and outcome.',
  ['event', 'outcome'],
);
const archiveClaimCounter = createLabeledCounter(
  'comms_archive_claims_total',
  'Archive worker claim outcomes.',
  ['outcome'],
);
const archiveOperationCounter = createLabeledCounter(
  'comms_archive_operations_total',
  'Archive transaction outcomes.',
  ['outcome'],
);
const archiveDuration = createLabeledHistogram(
  'comms_archive_operation_duration_seconds',
  'Archive transaction latency by bounded outcome.',
  ['outcome'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export const commsMetrics = {
  lifecycleDelivery(stream: string, outcome: LifecycleDeliveryOutcome): void {
    deliveryCounter.inc({ stream, outcome });
  },

  observeLifecycleHandler(
    stream: string,
    outcome: string,
    seconds: number,
  ): void {
    handlerDuration.observe({ stream, outcome }, seconds);
  },

  chatCreated(): void {
    chatCreatedCounter.inc({ source: 'errand_accepted' });
  },

  socketHandshake(outcome: 'accepted' | 'rejected'): void {
    socketHandshakeCounter.inc({ outcome });
  },

  socketConnected(): void {
    activeSocketGauge.inc();
  },

  socketDisconnected(): void {
    activeSocketGauge.dec();
  },

  observeSocketOperation(
    operation: SocketOperation,
    outcome: SocketOperationOutcome,
    seconds: number,
  ): void {
    socketOperationCounter.inc({ operation, outcome });
    socketOperationDuration.observe({ operation, outcome }, seconds);
  },

  socketAdapterError(role: 'publisher' | 'subscriber'): void {
    socketAdapterErrorCounter.inc({ role });
  },

  socketNotification(
    event: 'closing' | 'archived',
    outcome: 'emitted' | 'failed',
  ): void {
    socketNotificationCounter.inc({ event, outcome });
  },

  archiveClaim(outcome: 'claimed' | 'reclaimed' | 'empty' | 'failed'): void {
    archiveClaimCounter.inc({ outcome });
  },

  observeArchive(
    outcome: 'archived' | 'stale' | 'failed',
    seconds: number,
  ): void {
    archiveOperationCounter.inc({ outcome });
    archiveDuration.observe({ outcome }, seconds);
  },
};

function normalizedChatRoute(path: string): string | undefined {
  if (path === '/v1/chats' || path === '/v1/chats/') return '/v1/chats';
  if (path === '/v1/chats/archives' || path === '/v1/chats/archives/') {
    return '/v1/chats/archives';
  }
  if (/^\/v1\/chats\/archives\/[^/]+\/?$/.test(path)) {
    return '/v1/chats/archives/:archiveId';
  }
  if (/^\/v1\/chats\/[^/]+\/messages\/?$/.test(path)) {
    return '/v1/chats/:chatId/messages';
  }
  return undefined;
}

/** Records every chat API response, including guard, pipe, and filter errors. */
export const chatApiMetricsMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const route = normalizedChatRoute(request.path);
  if (route === undefined) {
    next();
    return;
  }
  const started = process.hrtime.bigint();
  response.once('finish', () => {
    const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
    const seconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
    apiCounter.inc({ route, status_class: statusClass });
    apiDuration.observe({ route, status_class: statusClass }, seconds);
  });
  next();
};
