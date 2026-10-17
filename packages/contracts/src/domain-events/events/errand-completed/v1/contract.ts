import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY =
  'order.errand-completed.v1';

export interface ErrandCompletedPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  amount: number;
}

export const errandCompletedV1Contract =
  defineEventContract<ErrandCompletedPayload>()({
    routingKey: ORDER_ERRAND_COMPLETED_V1_ROUTING_KEY,
    eventType: 'ErrandCompleted',
    publisher: 'order-service',
    schema,
  });
