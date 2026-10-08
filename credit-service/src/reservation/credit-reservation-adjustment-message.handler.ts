import {
  AccountEventContractValidator,
  CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
  type ContractViolation,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { ReservationAdjustmentService } from './reservation-adjustment.service.js';

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

/** Executes the synchronous adjustment transaction before acknowledgement. */
@Injectable()
export class CreditReservationAdjustmentMessageHandler implements RabbitMqMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly adjustments: ReservationAdjustmentService,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const validation = this.contracts.validate(
      CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
      message.body,
    );
    if (!validation.valid) {
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: validation.code,
        reason: contractFailureReason(validation.code, validation.violations),
      };
    }

    const result = await this.adjustments.adjust(validation.value);
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
