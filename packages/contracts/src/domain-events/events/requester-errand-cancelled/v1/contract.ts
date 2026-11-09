import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY =
  'order.requester-errand-cancelled.v1';

// Every cancellation reason the system can give (not the requester's own).
export type SystemCancellationReason =
  | 'SUPPLIER_UNAVAILABLE'
  | 'BUILDING_UNAVAILABLE'
  | 'SUPPLIER_VALIDATION_TIMEOUT'
  | 'INSUFFICIENT_CREDITS'
  | 'MISSING_BALANCE'
  | 'CREDIT_TIMEOUT'
  | 'ERRAND_EXPIRED'
  | 'PICKUP_TIME_EXCEEDED';

export interface RequesterErrandCancelledPayload {
  errandId: string;
  requesterUserId: string;
  cancellationReason: SystemCancellationReason;
}

// Tells the requester the system cancelled their errand. Separate from
// order.errand-cancelled.v1 (credit's release notice), which has no recipient
// and is not sent when nothing was reserved.
export const requesterErrandCancelledV1Contract =
  defineEventContract<RequesterErrandCancelledPayload>()({
    routingKey: ORDER_REQUESTER_ERRAND_CANCELLED_V1_ROUTING_KEY,
    eventType: 'RequesterErrandCancelled',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
