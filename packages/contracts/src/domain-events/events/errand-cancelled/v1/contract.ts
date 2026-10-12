import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY =
  'order.errand-cancelled.v1';

export interface ErrandCancelledPayload {
  errandId: string;
}

export const errandCancelledV1Contract =
  defineEventContract<ErrandCancelledPayload>()({
    routingKey: ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
    eventType: 'ErrandCancelled',
    publisher: 'order-service',
    schema,
  });
