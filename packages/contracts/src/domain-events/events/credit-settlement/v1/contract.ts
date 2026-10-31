import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_SETTLEMENT_V1_ROUTING_KEY = 'credit.settlement.v1';

export interface CreditSettlementPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  courierAmount: number;
  requesterAmount: number;
  attempt: number;
}

export const creditSettlementV1Contract =
  defineEventContract<CreditSettlementPayload>()({
    routingKey: CREDIT_SETTLEMENT_V1_ROUTING_KEY,
    eventType: 'CreditSettlementRequested',
    publisher: 'order-service',
    schema,
  });
