import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_ERRAND_UPDATE_V1_ROUTING_KEY = 'order.errand-update.v1';

// What happened; notification-service picks the recipients and copy from it.
export type ErrandUpdateKind =
  | 'PICKED_UP'
  | 'CANCELLED'
  | 'MARKED_INCOMPLETE'
  | 'TRANSFER_SETTLED'
  | 'TRANSFER_FAILED'
  | 'DISPUTE_RESOLVED';

export interface ErrandUpdatePayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  kind: ErrandUpdateKind;
  // DISPUTE_RESOLVED only: the admin's split and note.
  courierAmount?: number;
  requesterAmount?: number;
  note?: string;
}

// Tells the requester and/or courier about a milestone the other order events
// do not cover. Push-only; no other service consumes it.
export const errandUpdateV1Contract =
  defineEventContract<ErrandUpdatePayload>()({
    routingKey: ORDER_ERRAND_UPDATE_V1_ROUTING_KEY,
    eventType: 'ErrandUpdate',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
