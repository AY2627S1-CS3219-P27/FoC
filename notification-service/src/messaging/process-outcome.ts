/**
 * What the intake consumer should do with a delivery after the handler ran.
 *
 * Retries and dead-letters are published by the handler through the injected
 * publisher, so by the time an outcome is returned all durable work (row
 * updates + republish) has already happened: `acked` is safe, `dropped` means
 * the message is poison and must not be requeued.
 */
export type ProcessOutcome =
  | { readonly action: 'acked' }
  | { readonly action: 'dropped'; readonly reason: string };

/** A per-pair delivery/retry message published by the notification service. */
export interface NotifyRetryMessage {
  notificationGuid: string;
  subscriptionId: string;
}

/**
 * Broker access handed to the handler. Keeps broker mechanics (confirms,
 * exchanges, headers) in the messaging layer while letting the handler decide
 * per-pair retries and dead-letters.
 */
export interface NotifyMessagePublisher {
  /** Republish a per-pair retry with the next attempt and its backoff hop. */
  publishNotifyRetry(
    message: NotifyRetryMessage,
    nextAttempt: number,
  ): Promise<void>;
  /** Permanently park a failure on the dead-letter queue. */
  publishDeadLetter(
    message: unknown,
    routingKey: string,
    reason: string,
  ): Promise<void>;
}
