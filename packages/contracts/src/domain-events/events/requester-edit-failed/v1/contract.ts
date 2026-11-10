import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_REQUESTER_EDIT_FAILED_V1_ROUTING_KEY =
  'order.requester-edit-failed.v1';

// Which service refused the edit, and why. Supplier outcomes come from
// supplier.validation-completed.v1 (TIMEOUT: no answer in the hold window);
// credit reasons from credit.reservation-adjustment-rejected.v1.
export type EditFailedStep = 'supplier' | 'credit';
export type EditFailedReason =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'BUILDING_NOT_FOUND'
  | 'VENUE_NOT_FOUND'
  | 'TIMEOUT'
  | 'INSUFFICIENT_CREDITS'
  | 'RESERVATION_NOT_FOUND'
  | 'STALE_RESERVATION_AMOUNT';

export interface RequesterEditFailedPayload {
  errandId: string;
  requesterUserId: string;
  step: EditFailedStep;
  reason: EditFailedReason;
}

// Tells the requester an edit of their Open errand was refused and undone.
export const requesterEditFailedV1Contract =
  defineEventContract<RequesterEditFailedPayload>()({
    routingKey: ORDER_REQUESTER_EDIT_FAILED_V1_ROUTING_KEY,
    eventType: 'RequesterEditFailed',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
