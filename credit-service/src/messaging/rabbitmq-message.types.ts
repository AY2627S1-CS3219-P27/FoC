/**
 * Transport-neutral delivery passed to the application handler. `rawBody` is
 * retained so retry and dead-letter publications can preserve the exact bytes.
 */
export interface IncomingDomainMessage {
  body: unknown;
  rawBody: Buffer;
  routingKey: string;
  eventId?: string;
  retryCount: number;
}

export type PermanentMessageFailure =
  'INVALID_ENVELOPE' | 'INVALID_PAYLOAD' | 'UNSUPPORTED_EVENT_TYPE';

/**
 * The handler distinguishes committed work from permanent contract failures.
 * Thrown errors remain transient and are handled by the retry topology.
 */
export type MessageHandlingResult =
  | { outcome: 'ack' }
  | {
      outcome: 'dead-letter';
      eventId?: string;
      category: PermanentMessageFailure;
      reason: string;
    };

export interface RabbitMqMessageHandler {
  handle(message: IncomingDomainMessage): Promise<MessageHandlingResult>;
}

/** One independently consumed event stream and its permanent-failure queue. */
export interface Subscription {
  queue: string;
  /** One key, or several keys that all feed this queue and its handler. */
  routingKey: string | readonly string[];
  /** Exchange to bind on; defaults to the shared domain exchange. */
  exchange?: string;
  handler: RabbitMqMessageHandler;
  deadLetterQueue?: string;
}
