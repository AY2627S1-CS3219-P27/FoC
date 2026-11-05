/**
 * Broker names owned by the notification inbox.
 *
 * The topic exchange is shared infrastructure: root `rabbitmq/definitions.json`
 * owns the durable primary queue and its `#` binding to `foc.pubsub`. The
 * service owns only its retry chain, return binding, and dead-letter queue,
 * mirroring the Communication Service contract (ADR 0002).
 */
export const NOTIFICATION_DOMAIN_EXCHANGE = 'foc.pubsub';
export const NOTIFICATION_QUEUE = 'notification-service.inbox';
export const NOTIFICATION_DEAD_LETTER_QUEUE = `${NOTIFICATION_QUEUE}.dlq`;
export const NOTIFICATION_RETRY_EXCHANGE = 'foc.retry';
export const NOTIFICATION_RETRY_RETURN_EXCHANGE = 'foc.back';
export const NOTIFICATION_DEAD_LETTER_EXCHANGE = 'foc.dlq';

/** Header selecting a delay bucket on the shared headers exchange. */
export const RETRY_DELAY_HEADER = 'foc-delay';
export const RETRY_COUNT_HEADER = 'x-retry-count';
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-notification-routing-key';
