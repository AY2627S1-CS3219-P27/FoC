import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY =
  'credit.account-initialised.v1';

export interface CreditAccountInitialisedPayload {
  userId: string;
  creditAmountAllocated: number;
  creditAllocationId: string;
}

export const creditAccountInitialisedV1Contract =
  defineEventContract<CreditAccountInitialisedPayload>()({
    routingKey: CREDIT_ACCOUNT_INITIALISED_V1_ROUTING_KEY,
    eventType: 'CreditAccountInitialised',
    publisher: 'credit-service',
    schema,
  });
