import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY =
  'credit.release-rejected.v1';

export type CreditReleaseRejectionReason =
  'RESERVATION_NOT_FOUND' | 'ALREADY_TRANSFERRED';

export interface CreditReleaseRejectedPayload {
  errandId: string;
  requesterUserId: string;
  rejectionReason: CreditReleaseRejectionReason;
}

export const creditReleaseRejectedV1Contract =
  defineEventContract<CreditReleaseRejectedPayload>()({
    routingKey: CREDIT_RELEASE_REJECTED_V1_ROUTING_KEY,
    eventType: 'CreditReleaseRejected',
    publisher: 'credit-service',
    schema,
  });
