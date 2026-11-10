import {
  AccountEventContractValidator,
  type ContractViolation,
  DomainEventDispatcher,
  type DomainEventHandlers,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  USER_REGISTERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import { AccountInitializationService } from '../account-initialization/account-initialization.service.js';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { ReleaseService } from '../settlement/release.service.js';
import { TransferService } from '../settlement/transfer.service.js';

/** Routing keys of the fact events Credit Service consumes from foc.pubsub. */
export const CREDIT_EVENT_ROUTING_KEYS = [
  USER_REGISTERED_V1_ROUTING_KEY,
  ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
] as const;

function contractFailureReason(
  code: string,
  violations: ContractViolation[],
): string {
  const details = violations
    .map(
      ({ instancePath, keyword, message }) =>
        `${instancePath || '/'} ${keyword}: ${message}`,
    )
    .join('; ');
  return `${code}: ${details || 'contract validation failed'}`;
}

/** Maps a durable-ingress outcome to the transport's acknowledgement result. */
function ingressResult(outcome: {
  status: string;
  eventId?: string;
}): MessageHandlingResult {
  if (outcome.status === 'event-id-conflict') {
    return {
      outcome: 'dead-letter',
      eventId: outcome.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    };
  }
  return { outcome: 'ack' };
}

/**
 * Single handler for the shared `credit-service.events` stream. The shared
 * DomainEventDispatcher selects and validates the contract for each routing
 * key; each use case then commits durable work before the delivery is acked,
 * and thrown operational failures remain eligible for broker retries.
 */
@Injectable()
export class CreditEventsMessageHandler implements RabbitMqMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly initialization: AccountInitializationService,
    private readonly transfers: TransferService,
    private readonly releases: ReleaseService,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    let handled: MessageHandlingResult | undefined;
    const handlers: DomainEventHandlers = {
      [USER_REGISTERED_V1_ROUTING_KEY]: async (event) => {
        handled = ingressResult(await this.initialization.process(event));
      },
      [ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY]: async (event) => {
        handled = ingressResult(await this.transfers.accept(event));
      },
      [ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY]: async (event) => {
        handled = ingressResult(await this.releases.accept(event));
      },
    };

    const dispatched = await new DomainEventDispatcher(this.contracts).dispatch(
      message.routingKey,
      message.body,
      handlers,
    );

    if (dispatched.outcome === 'skipped') {
      // The queue binds only the keys above, so this indicates a topology bug.
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: 'UNSUPPORTED_EVENT_TYPE',
        reason: `no Credit Service handler for ${message.routingKey}`,
      };
    }
    if (dispatched.outcome === 'invalid') {
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: dispatched.code,
        reason: contractFailureReason(dispatched.code, dispatched.violations),
      };
    }
    if (handled === undefined) {
      throw new Error('Domain event handler completed without a result');
    }
    return handled;
  }
}
