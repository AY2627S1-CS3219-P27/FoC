import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import {
  AccountEventContractValidator,
  NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
} from '@foc/contracts';
import {
  Notification,
  NotificationStatus,
} from '../database/entities/notification.entity.js';
import {
  Subscription,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type {
  NotifyMessagePublisher,
  NotifyRetryMessage,
  ProcessOutcome,
} from '../messaging/process-outcome.js';
import {
  MAX_NOTIFY_ATTEMPTS,
  NOTIFY_RETRY_ROUTING_KEY,
  NOTIFY_ROUTING_KEY,
} from '../messaging/topology.js';
import {
  NOTIFICATION_SENDER,
  type NotificationSender,
} from './notification.sender.js';
import {
  type TranslatedNotification,
  NotifyTransformerRegistry,
} from './notify-transformer.registry.js';

/** One delivery as handed over by the intake consumer. */
export interface IncomingNotification {
  body: unknown;
  routingKey: string;
  /** 1-based delivery attempt from the `x-foc-attempt` header. */
  attempt: number;
}

function parseRetryBody(body: unknown): NotifyRetryMessage | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { notificationGuid, subscriptionId } = body as Record<string, unknown>;
  return typeof notificationGuid === 'string' &&
    isUUID(notificationGuid) &&
    typeof subscriptionId === 'string' &&
    isUUID(subscriptionId)
    ? { notificationGuid, subscriptionId }
    : null;
}

function pairBody(row: Notification): NotifyRetryMessage {
  return {
    notificationGuid: row.guid,
    subscriptionId: row.subscriptionId,
  };
}

/**
 * The intake pipeline.
 *
 * `notification.notify.v1` fans a logical notification out to the user's
 * active subscriptions and performs attempt 1. `notification.notify-retry.v1`
 * carries one per-pair retry and enforces the two NS3.1 guards: the pair must
 * exist (NS3.1.1) and the attempt header must match the stored attempt count
 * (NS3.1.2). Unsupported upstream events go through the transformer registry
 * first; anything unrecognised is poison and never retried.
 */
@Injectable()
export class NotifyHandler {
  private readonly logger = new Logger(NotifyHandler.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    @Inject(NOTIFICATION_SENDER)
    private readonly sender: NotificationSender,
    private readonly contracts: AccountEventContractValidator,
    private readonly transformers: NotifyTransformerRegistry,
  ) {}

  async handle(
    delivery: IncomingNotification,
    publisher: NotifyMessagePublisher,
  ): Promise<ProcessOutcome> {
    switch (delivery.routingKey) {
      case NOTIFY_ROUTING_KEY:
        return this.handleNotify(delivery, publisher);
      case NOTIFY_RETRY_ROUTING_KEY:
        return this.handleRetry(delivery, publisher);
      default:
        return this.handleUpstream(delivery, publisher);
    }
  }

  /** Canonical fan-out event: { notificationGuid, userId, content }. */
  private async handleNotify(
    delivery: IncomingNotification,
    publisher: NotifyMessagePublisher,
  ): Promise<ProcessOutcome> {
    const validation = this.contracts.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      delivery.body,
    );

    if (!validation.valid) {
      return {
        action: 'dropped',
        reason: `malformed notification event (${validation.code})`,
      };
    }

    const { notificationGuid, userId, content } = validation.value.payload;
    return this.fanOut({ notificationGuid, userId, content }, publisher);
  }

  /**
   * A producing service's own event. The transformer for its routing key
   * coerces it into the canonical shape; without one it is poison.
   */
  private async handleUpstream(
    delivery: IncomingNotification,
    publisher: NotifyMessagePublisher,
  ): Promise<ProcessOutcome> {
    const notification = this.transformers.translate(
      delivery.routingKey,
      delivery.body,
    );

    if (notification === null) {
      return {
        action: 'dropped',
        reason: `unsupported upstream event ${delivery.routingKey}`,
      };
    }

    return this.fanOut(notification, publisher);
  }

  private async fanOut(
    notification: TranslatedNotification,
    publisher: NotifyMessagePublisher,
  ): Promise<ProcessOutcome> {
    const recipients = await this.subscriptions.find({
      where: {
        userId: notification.userId,
        status: SubscriptionStatus.Active,
      },
    });

    for (const subscription of recipients) {
      const row = await this.ensurePendingRow(notification, subscription.id);
      if (row === null) {
        // Already delivered/failed, a retry is pending, or a concurrent
        // consumer inserted the pair: never send twice from the fan-out.
        continue;
      }
      await this.attemptDelivery(subscription, row, 1, publisher);
    }

    return { action: 'acked' };
  }

  /**
   * Returns the row this fan-out should attempt, or null when the pair is
   * already owned by another attempt. A pending attempt-1 row is re-attempted:
   * it is the left-over of a crash between insert and delivery, and requeuing
   * the fan-out event is the only thing that can finish it.
   */
  private async ensurePendingRow(
    notification: TranslatedNotification,
    subscriptionId: string,
  ): Promise<Notification | null> {
    const where = {
      guid: notification.notificationGuid,
      subscriptionId,
    };
    const existing = await this.notifications.findOne({ where });

    if (existing !== null) {
      return existing.status === NotificationStatus.Pending &&
        existing.attemptCount === 1
        ? existing
        : null;
    }

    await this.notifications
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values({
        guid: notification.notificationGuid,
        subscriptionId,
        attemptCount: 1,
        status: NotificationStatus.Pending,
        content: notification.content,
      })
      .orIgnore()
      .execute();

    const inserted = await this.notifications.findOne({ where });
    return inserted !== null && inserted.attemptCount === 1 ? inserted : null;
  }

  /**
   * NS3.1.1 + NS3.1.2: the pair must exist and the attempt must be the one the
   * table is waiting for. Both failures are acknowledged and dropped — a stale
   * duplicate must never cause a second push.
   */
  private async handleRetry(
    delivery: IncomingNotification,
    publisher: NotifyMessagePublisher,
  ): Promise<ProcessOutcome> {
    const pair = parseRetryBody(delivery.body);
    if (pair === null) {
      return { action: 'dropped', reason: 'malformed notify retry body' };
    }

    const row = await this.notifications.findOne({
      where: {
        guid: pair.notificationGuid,
        subscriptionId: pair.subscriptionId,
      },
    });

    if (row === null) {
      this.logger.warn(
        `Dropping retry for unknown notification pair ${pair.notificationGuid}/${pair.subscriptionId}`,
      );
      return { action: 'acked' };
    }

    if (row.status !== NotificationStatus.Pending) {
      this.logger.warn(
        `Dropping retry for ${row.status} notification ${pair.notificationGuid}/${pair.subscriptionId}`,
      );
      return { action: 'acked' };
    }

    if (row.attemptCount !== delivery.attempt) {
      this.logger.warn(
        `Dropping stale retry for ${pair.notificationGuid}/${pair.subscriptionId}: event attempt ${delivery.attempt}, stored ${row.attemptCount}`,
      );
      return { action: 'acked' };
    }

    const subscription = await this.subscriptions.findOne({
      where: { id: row.subscriptionId },
    });

    if (
      subscription === null ||
      subscription.status !== SubscriptionStatus.Active
    ) {
      row.status = NotificationStatus.Failed;
      await this.notifications.save(row);
      return { action: 'acked' };
    }

    await this.attemptDelivery(subscription, row, delivery.attempt, publisher);
    return { action: 'acked' };
  }

  /**
   * One delivery attempt. The retry copy is published *before* the attempt
   * counter advances, so a failed republish requeues the original message and
   * the same attempt is re-run instead of losing the notification.
   */
  private async attemptDelivery(
    subscription: Subscription,
    row: Notification,
    attempt: number,
    publisher: NotifyMessagePublisher,
  ): Promise<void> {
    try {
      await this.sender.send(subscription, row.content);
      row.status = NotificationStatus.Delivered;
      await this.notifications.save(row);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'delivery failed';

      if (attempt >= MAX_NOTIFY_ATTEMPTS) {
        row.status = NotificationStatus.Failed;
        await this.notifications.save(row);
        await publisher.publishDeadLetter(
          pairBody(row),
          NOTIFY_RETRY_ROUTING_KEY,
          reason,
        );
        this.logger.warn(
          `Notification ${row.guid} permanently failed for subscription ${row.subscriptionId} after ${attempt} attempts: ${reason}`,
        );
        return;
      }

      await publisher.publishNotifyRetry(pairBody(row), attempt + 1);
      row.attemptCount = attempt + 1;
      await this.notifications.save(row);
      this.logger.warn(
        `Notification ${row.guid} scheduled attempt ${attempt + 1} for subscription ${row.subscriptionId}: ${reason}`,
      );
    }
  }
}
