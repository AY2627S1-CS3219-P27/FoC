import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY =
  'credit.reservation-adjustment-rejected.v1';

export type CreditReservationAdjustmentRejectionReason =
  'RESERVATION_NOT_FOUND' | 'STALE_RESERVATION_AMOUNT' | 'INSUFFICIENT_CREDITS';

export interface CreditReservationAdjustmentRejectedPayload {
  errandId: string;
  requestedAmount: number;
  rejectionReason: CreditReservationAdjustmentRejectionReason;
}

export const creditReservationAdjustmentRejectedV1Contract =
  defineEventContract<CreditReservationAdjustmentRejectedPayload>()({
    routingKey: CREDIT_RESERVATION_ADJUSTMENT_REJECTED_V1_ROUTING_KEY,
    eventType: 'CreditReservationAdjustmentRejected',
    publisher: 'credit-service',
    schema,
  });
