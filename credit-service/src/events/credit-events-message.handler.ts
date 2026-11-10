import {
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  USER_REGISTERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import { UserRegisteredMessageHandler } from '../account-initialization/user-registered-message.handler.js';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { ErrandCancelledMessageHandler } from '../settlement/errand-cancelled-message.handler.js';
import { ErrandCompletedMessageHandler } from '../settlement/errand-completed-message.handler.js';

/** Routing keys of the fact events Credit Service consumes from foc.pubsub. */
export const CREDIT_EVENT_ROUTING_KEYS = [
  USER_REGISTERED_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
] as const;

/**
 * Fans one shared event stream out to the per-event use cases. Each delegate
 * still validates its own contract and acknowledges only after its durable
 * work commits, so this class adds routing and nothing else.
 */
@Injectable()
export class CreditEventsMessageHandler implements RabbitMqMessageHandler {
  private readonly delegates: ReadonlyMap<string, RabbitMqMessageHandler>;

  constructor(
    userRegistered: UserRegisteredMessageHandler,
    errandCompleted: ErrandCompletedMessageHandler,
    errandCancelled: ErrandCancelledMessageHandler,
  ) {
    this.delegates = new Map<string, RabbitMqMessageHandler>([
      [USER_REGISTERED_V1_ROUTING_KEY, userRegistered],
      [ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY, errandCompleted],
      [ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY, errandCancelled],
    ]);
  }

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const delegate = this.delegates.get(message.routingKey);
    if (delegate === undefined) {
      // The queue binds only the keys above, so this indicates a topology bug.
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: 'UNSUPPORTED_EVENT_TYPE',
        reason: `no Credit Service handler for ${message.routingKey}`,
      };
    }

    return delegate.handle(message);
  }
}
