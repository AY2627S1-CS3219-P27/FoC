import {
  AccountEventContractValidator,
  type ContractViolation,
  ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { SupplierValidationService } from './supplier-validation.service.js';

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

/**
 * Checks each supplier-validation request against the shared contract before
 * any database work, as credit-service's handlers do. A malformed request, or
 * one not published by order-service, is dead-lettered and never retried
 * (F15.7.6, F13.7). The request is acknowledged only after its reply is
 * committed to the outbox (F15.7.8); thrown errors stay transient, so the
 * transport retries them (F15.7.5).
 */
@Injectable()
export class SupplierValidationMessageHandler implements RabbitMqMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly validation: SupplierValidationService,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const request = this.contracts.validate(
      ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
      message.body,
    );
    if (!request.valid) {
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: request.code,
        reason: contractFailureReason(request.code, request.violations),
      };
    }

    const result = await this.validation.process(request.value);
    if (result.status === 'event-id-conflict') {
      return {
        outcome: 'dead-letter',
        eventId: result.eventId,
        category: 'INVALID_ENVELOPE',
        reason: 'event ID was previously processed with different content',
      };
    }
    return { outcome: 'ack' };
  }
}
