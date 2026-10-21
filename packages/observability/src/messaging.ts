import { trace } from '@opentelemetry/api';
import {
  ATTR_MESSAGING_MESSAGE_ID,
  ATTR_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
} from '@opentelemetry/semantic-conventions/incubating';

/**
 * Delivery attributes application code knows but the amqplib instrumentation
 * cannot see: the domain event id lives in the JSON payload, and the retry
 * count lives in the service-owned retry topology's `x-retry-count` header.
 */
export interface ConsumeSpanAttributes {
  /** Domain event id (`event.id` in the payload), not the AMQP message id. */
  messageId?: string;
  /** Route this attempt was delivered on (`message.fields.routingKey`). */
  routingKey?: string;
  /** Attempt number from `x-retry-count` (0 on the first delivery). */
  retryCount?: number;
}

/**
 * Semconv has no retry-count attribute; retries are a service-owned RabbitMQ
 * retry-topology concept, so the custom key follows the semconv RabbitMQ
 * message naming (cf. `messaging.rabbitmq.message.delivery_tag`).
 */
export const MESSAGE_RETRY_COUNT_ATTRIBUTE =
  'messaging.rabbitmq.message.retry_count';

/**
 * Annotate the active amqplib consume span with domain-level delivery
 * attributes. Unknown values are skipped, and the function is a no-op when no
 * span is active (unit tests, or an app running without instrumentation).
 */
export function annotateConsumeSpan(attributes: ConsumeSpanAttributes): void {
  const span = trace.getActiveSpan();

  if (!span) {
    return;
  }

  if (attributes.messageId !== undefined) {
    span.setAttribute(ATTR_MESSAGING_MESSAGE_ID, attributes.messageId);
  }

  if (attributes.routingKey !== undefined) {
    span.setAttribute(
      ATTR_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
      attributes.routingKey,
    );
  }

  if (attributes.retryCount !== undefined) {
    span.setAttribute(MESSAGE_RETRY_COUNT_ATTRIBUTE, attributes.retryCount);
  }
}
