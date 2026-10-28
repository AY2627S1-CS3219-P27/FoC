import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY =
  'credit.settlement-succeeded.v1';

export interface CreditSettlementSucceededPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  courierAmount: number;
  requesterAmount: number;
  creditTransactionId: string;
}

export const creditSettlementSucceededV1Contract =
  defineEventContract<CreditSettlementSucceededPayload>()({
    routingKey: CREDIT_SETTLEMENT_SUCCEEDED_V1_ROUTING_KEY,
    eventType: 'CreditSettlementSucceeded',
    publisher: 'credit-service',
    schema,
  });
