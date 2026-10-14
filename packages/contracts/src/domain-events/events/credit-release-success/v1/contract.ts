import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY =
  'credit.release-success.v1';

export interface CreditReleaseSuccessPayload {
  errandId: string;
  requesterUserId: string;
  releasedAmount: number;
  creditTransactionId: string;
}

export const creditReleaseSuccessV1Contract =
  defineEventContract<CreditReleaseSuccessPayload>()({
    routingKey: CREDIT_RELEASE_SUCCESS_V1_ROUTING_KEY,
    eventType: 'CreditReleaseSuccess',
    publisher: 'credit-service',
    schema,
  });
