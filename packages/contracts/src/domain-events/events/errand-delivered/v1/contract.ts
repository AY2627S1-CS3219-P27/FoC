import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY =
  'order.errand-delivered.v1';

export interface ErrandDeliveredPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
}

export const errandDeliveredV1Contract =
  defineEventContract<ErrandDeliveredPayload>()({
    routingKey: ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
    eventType: 'ErrandDelivered',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
