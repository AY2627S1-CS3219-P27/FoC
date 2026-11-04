import {
  createLabeledCounter,
  createLabeledHistogram,
} from '@foc/observability';
import type { RequestHandler } from 'express';

export type LifecycleDeliveryOutcome =
  'successful' | 'duplicate' | 'retried' | 'dead_lettered' | 'conflicting';

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
};

function normalizedChatRoute(path: string): string | undefined {
  if (path === '/v1/chats' || path === '/v1/chats/') return '/v1/chats';
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
