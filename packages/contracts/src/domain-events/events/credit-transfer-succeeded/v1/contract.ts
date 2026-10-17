import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY =
  'credit.transfer-succeeded.v1';

export interface CreditTransferSucceededPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  transferredAmount: number;
  creditTransactionId: string;
}

export const creditTransferSucceededV1Contract =
  defineEventContract<CreditTransferSucceededPayload>()({
    routingKey: CREDIT_TRANSFER_SUCCEEDED_V1_ROUTING_KEY,
    eventType: 'CreditTransferSucceeded',
    publisher: 'credit-service',
    schema,
  });
