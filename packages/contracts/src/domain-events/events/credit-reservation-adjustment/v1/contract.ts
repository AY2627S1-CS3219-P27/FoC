import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY =
  'credit.reservation-adjustment.v1';

export interface CreditReservationAdjustmentPayload {
  errandId: string;
  oldAmount: number;
  newAmount: number;
}

export const creditReservationAdjustmentV1Contract =
  defineEventContract<CreditReservationAdjustmentPayload>()({
    routingKey: CREDIT_RESERVATION_ADJUSTMENT_V1_ROUTING_KEY,
    eventType: 'CreditReservationAdjustment',
    publisher: 'order-service',
    schema,
  });
