import {
  AccountEventContractValidator,
  type ContractViolation,
  DomainEventDispatcher,
  type DomainEventHandlers,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type {
  IncomingLifecycleMessage,
  LifecycleMessageHandler,
  LifecycleMessageHandlingResult,
} from '../messaging/rabbitmq-message.types.js';
import { commsMetrics } from '../observability/comms-metrics.js';
import {
  type LifecycleEvent,
  hasDistinctParticipants,
} from './lifecycle-event.js';
import { LifecycleIngestionService } from './lifecycle-ingestion.service.js';

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

@Injectable()
export class LifecycleMessageDispatcher implements LifecycleMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly ingestion: LifecycleIngestionService,
  ) {}

  async handle(
    message: IncomingLifecycleMessage,
  ): Promise<LifecycleMessageHandlingResult> {
    let handlingResult: LifecycleMessageHandlingResult | undefined;
    const handle = async (event: LifecycleEvent, routingKey: string) => {
      handlingResult = await this.processValidated(event, routingKey);
    };
    const handlers: DomainEventHandlers = {
      [ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY]: (event) =>
        handle(event, ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY),
      [ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY]: (event) =>
        handle(event, ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY),
      [ORDER_COURIER_CANCELLED_V1_ROUTING_KEY]: (event) =>
        handle(event, ORDER_COURIER_CANCELLED_V1_ROUTING_KEY),
      [ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY]: (event) =>
        handle(event, ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY),
    };
    const result = await new DomainEventDispatcher(this.contracts).dispatch(
      message.routingKey,
      message.body,
      handlers,
    );

    if (result.outcome === 'skipped') return { outcome: 'skipped' };
    if (result.outcome === 'invalid') {
      return {
        outcome: 'permanent-failure',
        eventId: message.eventId,
        category: result.code,
        reason: contractFailureReason(result.code, result.violations),
      };
    }
    if (handlingResult === undefined) {
      throw new Error('Domain event handler completed without a result');
    }
    return handlingResult;
  }

  private async processValidated(
    event: LifecycleEvent,
    routingKey: string,
  ): Promise<LifecycleMessageHandlingResult> {
    if (!hasDistinctParticipants(event)) {
      return {
        outcome: 'permanent-failure',
        eventId: event.eventId,
        category: 'INVALID_PAYLOAD',
        reason: 'requester and courier must be different users',
      };
    }

    const result = await this.ingestion.process(event, routingKey);
    switch (result.status) {
      case 'recorded':
        if (result.chatId !== undefined) commsMetrics.chatCreated();
        return { outcome: 'processed' };
      case 'duplicate':
        return { outcome: 'duplicate' };
      case 'event-id-conflict':
        return {
          outcome: 'permanent-failure',
          eventId: result.eventId,
          category: 'IDENTITY_CONFLICT',
          reason: 'event ID was previously recorded with different evidence',
        };
    }
  }
}
