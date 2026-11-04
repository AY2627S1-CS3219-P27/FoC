import { Injectable, Logger } from '@nestjs/common';
import type { Subscription } from '../database/entities/subscription.entity.js';
import type { NotificationContent } from '../database/entities/notification.entity.js';

/** Injection token so NS2 can swap the stub without touching callers. */
export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

export interface NotificationSender {
  /**
   * Delivers one notification to one subscription.
   *
   * Must throw on a delivery failure; the handler decides whether that becomes
   * a retry or a permanent failure.
   */
  send(subscription: Subscription, content: NotificationContent): Promise<void>;
}

/**
 * Placeholder delivery mechanism (NS2).
 *
 * TODO(NS2): send through the Web Push protocol using `web-push` with the
 * VAPID keypair (public key served to browsers, private key in
 * secrets/vapid_private_key.secret), and treat a push service 404/410 as a
 * dead endpoint (fail the notification and soft-delete the subscription).
 */
@Injectable()
export class StubNotificationSender implements NotificationSender {
  private readonly logger = new Logger(StubNotificationSender.name);

  async send(
    subscription: Subscription,
    content: NotificationContent,
  ): Promise<void> {
    this.logger.log(
      `Stub delivery to ${subscription.endpoint}: "${content.title}" (NS2 not implemented)`,
    );
  }
}
