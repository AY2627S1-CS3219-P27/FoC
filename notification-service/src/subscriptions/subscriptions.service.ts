import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type { RegisterWebPushSubscriptionDto } from './subscriptions.dto.js';

export interface RegisterWebPushResult {
  /** True when this call inserted the row, false when it refreshed one. */
  created: boolean;
  subscription: Subscription;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code ===
      POSTGRES_UNIQUE_VIOLATION
  );
}

function toExpirationDate(
  expirationTime: number | null | undefined,
): Date | null {
  return expirationTime === undefined || expirationTime === null
    ? null
    : new Date(expirationTime);
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  /**
   * Creates, reactivates or refreshes the row for `(userId, endpoint)`.
   *
   * The browser re-posts the same PushSubscription whenever it rotates keys,
   * so an existing active row is refreshed in place; an inactive row is
   * brought back for the same reason. Only a first-time pair inserts.
   */
  async registerWebPush(
    userId: string,
    input: RegisterWebPushSubscriptionDto,
  ): Promise<RegisterWebPushResult> {
    const existing = await this.subscriptions.findOne({
      where: { userId, endpoint: input.endpoint },
    });

    if (existing === null) {
      const created = this.subscriptions.create({
        userId,
        channel: SubscriptionChannel.WebPush,
        endpoint: input.endpoint,
        credentials: {
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
        },
        expirationTime: toExpirationDate(input.expirationTime),
        status: SubscriptionStatus.Active,
        deactivatedAt: null,
      });

      try {
        return {
          created: true,
          subscription: await this.subscriptions.save(created),
        };
      } catch (error) {
        // Two tabs (or a retry) registering one endpoint can race the insert;
        // the loser refreshes the row the winner created.
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    const subscription = await this.subscriptions.findOneOrFail({
      where: { userId, endpoint: input.endpoint },
    });
    subscription.channel = SubscriptionChannel.WebPush;
    subscription.credentials = {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    };
    subscription.expirationTime = toExpirationDate(input.expirationTime);
    subscription.status = SubscriptionStatus.Active;
    subscription.deactivatedAt = null;

    return {
      created: false,
      subscription: await this.subscriptions.save(subscription),
    };
  }

  /**
   * Soft-deletes the `(userId, endpoint)` row (FR NS5.2).
   *
   * Idempotent by design: an unknown endpoint, someone else's endpoint and an
   * already-inactive row all succeed without changing anything.
   */
  async deactivateWebPush(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.update(
      {
        userId,
        endpoint,
        status: SubscriptionStatus.Active,
      },
      {
        status: SubscriptionStatus.Inactive,
        deactivatedAt: new Date(),
      },
    );
  }
}
