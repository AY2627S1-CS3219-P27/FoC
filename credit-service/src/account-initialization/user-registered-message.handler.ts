import { Injectable } from '@nestjs/common';
import type { ContractViolation } from '../contracts/account-event-contract.types.js';
import { AccountEventContractValidator } from '../contracts/account-event-contract.validator.js';
import type {
  IncomingDomainMessage,
  MessageHandlingResult,
  RabbitMqMessageHandler,
} from '../messaging/rabbitmq-message.types.js';
import { AccountInitializationService } from './account-initialization.service.js';

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
 * Keeps permanent wire failures outside the database boundary. A successful
 * acknowledgement is returned only after AccountInitializationService has
 * committed; thrown operational failures remain eligible for broker retries.
 */
@Injectable()
export class UserRegisteredMessageHandler implements RabbitMqMessageHandler {
  constructor(
    private readonly contracts: AccountEventContractValidator,
    private readonly initialization: AccountInitializationService,
  ) {}

  async handle(message: IncomingDomainMessage): Promise<MessageHandlingResult> {
    const validation = this.contracts.validateUserRegistered(message.body);
    if (!validation.valid) {
      return {
        outcome: 'dead-letter',
        eventId: message.eventId,
        category: validation.code,
        reason: contractFailureReason(validation.code, validation.violations),
      };
    }

    const result = await this.initialization.process(validation.value);
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
