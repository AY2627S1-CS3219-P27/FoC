import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY =
  'credit.reservation-success.v1';

export interface CreditReservationSuccessPayload {
  errandId: string;
  requesterUserId: string;
  reservedAmount: number;
  creditTransactionId: string;
}

export const creditReservationSuccessV1Contract =
  defineEventContract<CreditReservationSuccessPayload>()({
    routingKey: CREDIT_RESERVATION_SUCCESS_V1_ROUTING_KEY,
    eventType: 'CreditReservationSuccess',
    publisher: 'credit-service',
    schema,
  });
