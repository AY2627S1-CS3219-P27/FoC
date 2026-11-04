/** A decoded delivery whose transport route and retry metadata are valid. */
export interface IncomingLifecycleMessage {
  body: unknown;
  rawBody: Buffer;
  routingKey: string;
  eventId?: string;
  retryCount: number;
}

export type PermanentMessageFailure =
  | 'INVALID_ENVELOPE'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'IDENTITY_CONFLICT';

/**
 * Application outcomes are explicit so duplicate/conflict decisions never
 * depend on exception text. Thrown errors are also treated as transient.
 */
export type LifecycleMessageHandlingResult =
  | { outcome: 'processed' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient-failure'; reason: string }
  | {
      outcome: 'permanent-failure';
      eventId?: string;
      category: PermanentMessageFailure;
      reason: string;
    };

export interface LifecycleMessageHandler {
  handle(
    message: IncomingLifecycleMessage,
  ): Promise<LifecycleMessageHandlingResult>;
}

export interface LifecycleSubscription {
  queue: string;
  routingKey: string;
  handler: LifecycleMessageHandler;
}
