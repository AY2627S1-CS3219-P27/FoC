import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { SecretService } from '../secret/secret.service.js';
import type { Subscription } from '../database/entities/index.js';
import type { NotificationMessage } from './notification-message.js';

export type WebPushOutcome = 'sent' | 'expired';

/**
 * Push services answer 404 or 410 for a subscription the browser has revoked.
 * Retrying cannot succeed, so the caller deactivates the subscription instead
 * of consuming the event's retry budget.
 */
export function isExpiredSubscriptionError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

@Injectable()
export class WebPushSender {
  constructor(config: ConfigService, secrets: SecretService) {
    webpush.setVapidDetails(
      config.getOrThrow('VAPID_SUBJECT'),
      config.getOrThrow('VAPID_PUBLIC_KEY'),
      secrets.getVapidPrivateKey(),
    );
  }

  async send(
    subscription: Subscription,
    message: NotificationMessage,
  ): Promise<WebPushOutcome> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime?.getTime() ?? null,
          keys: subscription.credentials,
        },
        JSON.stringify(message),
        { TTL: 60 * 60 },
      );
      return 'sent';
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        return 'expired';
      }
      throw error;
    }
  }
}
