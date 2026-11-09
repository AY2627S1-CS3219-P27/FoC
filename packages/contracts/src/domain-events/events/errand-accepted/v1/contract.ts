import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY = 'order.errand-accepted.v1';

export interface ErrandAcceptedPayload {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
}

export const errandAcceptedV1Contract =
  defineEventContract<ErrandAcceptedPayload>()({
    routingKey: ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
    eventType: 'ErrandAccepted',
    publisher: 'order-service',
    kind: 'event',
    schema,
  });
