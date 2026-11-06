import {
  AccountEventContractValidator,
  CREDIT_SETTLEMENT_V1_ROUTING_KEY,
  type ContractViolation,
} from '@foc/contracts';
import { Injectable } from '@nestjs/common';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { SettlementService } from './settlement.service.js';

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

/** Acknowledges a settlement request only after durable ingress commits. */
@Injectable()
export class CreditSettlementMessageHandler implements RabbitMqMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly settlements: SettlementService,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const validation = this.contracts.validate(
      CREDIT_SETTLEMENT_V1_ROUTING_KEY,
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

    const result = await this.settlements.accept(validation.value);
    if (result.status === 'event-id-conflict') {
      return {
        outcome: 'dead-letter',
        eventId: result.eventId,
        category: 'INVALID_ENVELOPE',
        reason: result.reason,
      };
    }
    if (
      result.status === 'attempt-conflict' ||
      result.status === 'invalid-command'
    ) {
      return {
        outcome: 'dead-letter',
        eventId: result.eventId,
        category: 'INVALID_PAYLOAD',
        reason: result.reason,
      };
    }
    return { outcome: 'ack' };
  }
}
