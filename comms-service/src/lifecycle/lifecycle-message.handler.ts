import {
  AccountEventContractValidator,
  type ContractValidationResult,
  type ContractViolation,
  type EventContractFailureCode,
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
    switch (message.routingKey) {
      case ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY:
        return this.processValidation(
          message,
          this.contracts.validate(
            ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
            message.body,
          ),
        );
      case ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY:
        return this.processValidation(
          message,
          this.contracts.validate(
            ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
            message.body,
          ),
        );
      case ORDER_COURIER_CANCELLED_V1_ROUTING_KEY:
        return this.processValidation(
          message,
          this.contracts.validate(
            ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
            message.body,
          ),
        );
      case ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY:
        return this.processValidation(
          message,
          this.contracts.validate(
            ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
            message.body,
          ),
        );
      default:
        return {
          outcome: 'permanent-failure',
          eventId: message.eventId,
          category: 'UNSUPPORTED_EVENT_TYPE',
          reason: 'routing key is not a supported lifecycle contract',
        };
    }
  }

  private async processValidation<TEvent extends LifecycleEvent>(
    message: IncomingLifecycleMessage,
    validation: ContractValidationResult<TEvent, EventContractFailureCode>,
  ): Promise<LifecycleMessageHandlingResult> {
    if (!validation.valid) {
      return {
        outcome: 'permanent-failure',
        eventId: message.eventId,
        category: validation.code,
        reason: contractFailureReason(validation.code, validation.violations),
      };
    }
    if (!hasDistinctParticipants(validation.value)) {
      return {
        outcome: 'permanent-failure',
        eventId: validation.value.eventId,
        category: 'INVALID_PAYLOAD',
        reason: 'requester and courier must be different users',
      };
    }

    const result = await this.ingestion.process(
      validation.value,
      message.routingKey,
    );
    switch (result.status) {
      case 'recorded':
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
