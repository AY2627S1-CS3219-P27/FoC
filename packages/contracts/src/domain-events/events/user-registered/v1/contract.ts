import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const USER_REGISTERED_V1_ROUTING_KEY = 'user.registered.v1';

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  displayName: string;
}

export const userRegisteredV1Contract =
  defineEventContract<UserRegisteredPayload>()({
    routingKey: USER_REGISTERED_V1_ROUTING_KEY,
    eventType: 'UserRegistered',
    publisher: 'user-service',
    schema,
  });
