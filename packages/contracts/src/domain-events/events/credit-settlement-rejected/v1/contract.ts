import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY =
  'credit.settlement-rejected.v1';

export type CreditSettlementRejectionReason =
  // courierAmount + requesterAmount differs from the reserved amount. The
  // schema cannot check the sum; credit-service does.
  | 'AMOUNT_MISMATCH'
  // The receiving account is archived. Mirrors the transfer rejection; not
  // emitted by credit-service yet.
  | 'DESTINATION_ARCHIVED'
  // Credit-service holds no reservation for this errand.
  | 'RESERVATION_NOT_FOUND'
  // The reservation was already released, so nothing is left to split.
  | 'RESERVATION_RELEASED'
  // The requester or courier in the notice differs from the participants
  // credit-service recorded for the reservation.
  | 'RESERVATION_USER_MISMATCH';

export interface CreditSettlementRejectedPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  rejectionReason: CreditSettlementRejectionReason;
}

export const creditSettlementRejectedV1Contract =
  defineEventContract<CreditSettlementRejectedPayload>()({
    routingKey: CREDIT_SETTLEMENT_REJECTED_V1_ROUTING_KEY,
    eventType: 'CreditSettlementRejected',
    publisher: 'credit-service',
    schema,
  });
