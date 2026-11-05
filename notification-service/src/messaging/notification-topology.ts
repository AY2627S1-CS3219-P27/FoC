import type { Channel } from 'amqplib';

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

/**
 * Declares everything the consumer owns. The shared exchanges and the primary
 * queue are checked, never declared: root infrastructure owns them.
 */
export async function declareInboxTopology(
  channel: Channel,
  retryDelays: readonly number[],
): Promise<void> {
  // Shared infrastructure: fail startup if the primary queue or exchange is
  // absent rather than silently consuming nothing.
  await channel.checkExchange(NOTIFICATION_DOMAIN_EXCHANGE);
  await channel.checkQueue(NOTIFICATION_QUEUE);

  for (const [index, delay] of retryDelays.entries()) {
    const retryQueue = `${NOTIFICATION_QUEUE}.retry.${index + 1}`;
    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        'x-queue-type': 'classic',
        'x-message-ttl': delay,
        'x-dead-letter-exchange': NOTIFICATION_RETRY_RETURN_EXCHANGE,
        'x-dead-letter-routing-key': NOTIFICATION_QUEUE,
      },
    });
    await channel.bindQueue(retryQueue, NOTIFICATION_RETRY_EXCHANGE, '', {
      'x-match': 'all',
      [RETRY_DELAY_HEADER]: String(delay),
    });
  }

  // Retries return through the shared return exchange, addressed by queue.
  await channel.bindQueue(
    NOTIFICATION_QUEUE,
    NOTIFICATION_RETRY_RETURN_EXCHANGE,
    NOTIFICATION_QUEUE,
  );

  await channel.assertQueue(NOTIFICATION_DEAD_LETTER_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'classic' },
  });
  await channel.bindQueue(
    NOTIFICATION_DEAD_LETTER_QUEUE,
    NOTIFICATION_DEAD_LETTER_EXCHANGE,
    NOTIFICATION_DEAD_LETTER_QUEUE,
  );
}
