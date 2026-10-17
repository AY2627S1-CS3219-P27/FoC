import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY =
  'credit.transfer-rejected.v1';

export type CreditTransferRejectionReason =
  'DESTINATION_ARCHIVED' | 'RESERVATION_NOT_FOUND' | 'RESERVATION_RELEASED' | 'RESERVATION_USER_MISMATCH';

export interface CreditTransferRejectedPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  rejectionReason: CreditTransferRejectionReason;
}

export const creditTransferRejectedV1Contract =
  defineEventContract<CreditTransferRejectedPayload>()({
    routingKey: CREDIT_TRANSFER_REJECTED_V1_ROUTING_KEY,
    eventType: 'CreditTransferRejected',
    publisher: 'credit-service',
    schema,
  });
