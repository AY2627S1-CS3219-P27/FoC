import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY =
  'credit.reservation-rejected.v1';

export type CreditReservationRejectionReason =
  'MISSING_BALANCE' | 'INSUFFICIENT_CREDITS' | 'RESERVATION_CONFLICT';

export interface CreditReservationRejectedPayload {
  errandId: string;
  requesterUserId: string;
  requestedAmount: number;
  rejectionReason: CreditReservationRejectionReason;
}

export const creditReservationRejectedV1Contract =
  defineEventContract<CreditReservationRejectedPayload>()({
    routingKey: CREDIT_RESERVATION_REJECTED_V1_ROUTING_KEY,
    eventType: 'CreditReservationRejected',
    publisher: 'credit-service',
    schema,
  });
