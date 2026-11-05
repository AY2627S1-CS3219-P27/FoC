import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AnyDomainEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import {
  NotificationDelivery,
  NotificationDeliveryStatus,
  SubscriptionStatus,
} from '../database/entities/index.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { NotificationMessage } from './notification-message.js';
import { WebPushSender } from './web-push.sender.js';

/** What one event's dispatcher decided to deliver to whom. */
export interface DispatchPlan {
  recipients: readonly string[];
  message: NotificationMessage;
}

/**
 * Durable fan-out and push execution.
 *
 * Dispatchers call `enqueue` with the recipients and message they chose; the
 * unique `(event_id, subscription_id)` pair makes a repeated enqueue for a
 * broker redelivery a no-op. `deliverPending` is a separate step so a crash
 * between recording and sending resumes from the still-pending rows.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly webPush: WebPushSender,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Receives a domain event, pairs it with its subscription, and creates
   * a NotificationDelivery record that is `Pending`.
   */
  async enqueue(event: AnyDomainEvent, plan: DispatchPlan): Promise<void> {
    const recipients = [...new Set(plan.recipients)];
    if (recipients.length === 0) {
      return;
    }

    // The subscriptions module owns its table; ask it for active destinations.
    const subscriptions =
      await this.subscriptions.findActiveWebPush(recipients);
    if (subscriptions.length === 0) {
      return;
    }

    // Creates a NotificationDelivery record that is pending.
    await this.dataSource
      .getRepository(NotificationDelivery)
      .createQueryBuilder()
      .insert()
      .into(NotificationDelivery)
      .values(
        subscriptions.map((subscription) => ({
          eventId: event.eventId,
          subscriptionId: subscription.id,
          userId: subscription.userId,
          status: NotificationDeliveryStatus.Pending,
          message: plan.message,
          attempts: 0,
          lastError: null,
          sentAt: null,
        })),
      )
      // A redelivery re-runs the dispatcher; this keeps its enqueue a no-op.
      .orIgnore()
      .execute();
  }

  /**
   * Attempts a delivery on all pending notifications related to
   * the eventId.
   */
  async deliverPending(eventId: string): Promise<void> {
    const deliveries = await this.dataSource
      .getRepository(NotificationDelivery)
      .find({
        where: { eventId, status: NotificationDeliveryStatus.Pending },
        relations: { subscription: true },
        order: { createdAt: 'ASC' },
      });

    for (const delivery of deliveries) {
      if (delivery.subscription.status !== SubscriptionStatus.Active) {
        await this.abandon(delivery, 'subscription is inactive');
        continue;
      }

      try {
        const outcome = await this.webPush.send(
          delivery.subscription,
          delivery.message,
        );
        if (outcome === 'expired') {
          // Expired (410/404) endpoints should no longer be used - deactivate
          // them.
          await this.subscriptions.deactivateWebPush(
            delivery.subscription.userId,
            delivery.subscription.endpoint,
          );
          await this.abandon(delivery, 'push service reported 404/410');
          continue;
        }

        await this.markSent(delivery);
      } catch (error) {
        // Transient: keep the row pending and let the transport retry the
        // whole event. Already-sent deliveries are skipped on the next pass.
        await this.recordFailure(delivery, error);
        throw error;
      }
    }
  }

  private async markSent(delivery: NotificationDelivery): Promise<void> {
    await this.dataSource
      .getRepository(NotificationDelivery)
      .update(delivery.id, {
        status: NotificationDeliveryStatus.Sent,
        attempts: delivery.attempts + 1,
        lastError: null,
        sentAt: new Date(),
      });
  }

  /**
   * Abandons a delivery - prevents further attempts to send
   * to the same (stale) endpoint.
   */
  private async abandon(
    delivery: NotificationDelivery,
    reason: string,
  ): Promise<void> {
    await this.dataSource
      .getRepository(NotificationDelivery)
      .update(delivery.id, {
        status: NotificationDeliveryStatus.Abandoned,
        attempts: delivery.attempts + 1,
        lastError: reason,
      });
    this.logger.warn(
      `Abandoned delivery ${delivery.id} for event ${delivery.eventId}: ${reason}`,
    );
  }

  private async recordFailure(
    delivery: NotificationDelivery,
    error: unknown,
  ): Promise<void> {
    await this.dataSource
      .getRepository(NotificationDelivery)
      .update(delivery.id, {
        attempts: delivery.attempts + 1,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : 'push delivery failed',
      });
  }
}
