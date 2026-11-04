import { defineEventContract } from '../../../event-contract.types.js';
import schema from './schema.json' with { type: 'json' };

export const NOTIFICATION_NOTIFY_V1_ROUTING_KEY = 'notification.notify.v1';

/**
 * One logical notification for one user. The notification service fans it out
 * to that user's active push subscriptions, one `notifications` row per
 * (notificationGuid, subscriptionId) pair.
 */
export interface NotificationNotifyPayload {
  /** Stable identity of the logical notification (drives at-most-once fan-out). */
  notificationGuid: string;
  /** The user whose push subscriptions should receive it. */
  userId: string;
  content: {
    title: string;
    body: string;
  };
}

export const notificationNotifyV1Contract =
  defineEventContract<NotificationNotifyPayload>()({
    routingKey: NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
    eventType: 'NotificationNotify',
    publisher: 'notification-service',
    schema,
  });
