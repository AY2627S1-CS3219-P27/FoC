import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_COURIER_CANCELLED_V1_ROUTING_KEY =
  'order.courier-cancelled.v1';

export interface CourierCancelledPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
}

export const courierCancelledV1Contract =
  defineEventContract<CourierCancelledPayload>()({
    routingKey: ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
    eventType: 'CourierCancelled',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
