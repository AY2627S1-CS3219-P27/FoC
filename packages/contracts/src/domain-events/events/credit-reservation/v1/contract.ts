import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_RESERVATION_V1_ROUTING_KEY = 'credit.reservation.v1';

export interface CreditReservationPayload {
  errandId: string;
  requesterUserId: string;
  amount: number;
}

export const creditReservationV1Contract =
  defineEventContract<CreditReservationPayload>()({
    routingKey: CREDIT_RESERVATION_V1_ROUTING_KEY,
    eventType: 'CreditReservation',
    publisher: 'order-service',
    schema,
  });
