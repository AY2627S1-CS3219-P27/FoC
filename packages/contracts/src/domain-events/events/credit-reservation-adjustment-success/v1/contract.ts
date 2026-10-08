import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY =
  'credit.reservation-adjustment-success.v1';

export interface CreditReservationAdjustmentSuccessPayload {
  errandId: string;
  newReservedAmount: number;
  creditTransactionId: string;
}

export const creditReservationAdjustmentSuccessV1Contract =
  defineEventContract<CreditReservationAdjustmentSuccessPayload>()({
    routingKey: CREDIT_RESERVATION_ADJUSTMENT_SUCCESS_V1_ROUTING_KEY,
    eventType: 'CreditReservationAdjustmentSuccess',
    publisher: 'credit-service',
    schema,
  });
