import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type {
  RegisterWebPushSubscriptionDto,
  UpdateWebPushSubscriptionDto,
} from './subscriptions.dto.js';

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
   * Inserts a new subscription for `(userId, endpoint)`.
   *
   * A pair that already exists is a conflict: re-presenting a subscription is
   * a PATCH, not another create. The unique-violation race (two tabs
   * registering the same endpoint) maps to the same conflict.
   */
  async createWebPush(
    userId: string,
    input: RegisterWebPushSubscriptionDto,
  ): Promise<Subscription> {
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
      return await this.subscriptions.save(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_ALREADY_EXISTS',
          message: 'A subscription for this endpoint already exists',
        });
      }
      throw error;
    }
  }

  /**
   * Reconciles a re-presented live subscription with its stored row.
   *
   * The browser can only hand back live PushSubscriptions, so `status:
   * "active"` reactivates a soft-deleted row (clearing `deactivated_at`) and
   * fresh `keys`/`expirationTime` overwrite the stored credentials. The
   * endpoint is identity and is never changed here.
   */
  async updateWebPush(
    userId: string,
    endpoint: string,
    patch: UpdateWebPushSubscriptionDto,
  ): Promise<Subscription> {
    const subscription = await this.subscriptions.findOne({
      where: { userId, endpoint },
    });

    if (subscription === null) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription exists for this endpoint',
      });
    }

    if (patch.status !== undefined) {
      subscription.status = SubscriptionStatus.Active;
      subscription.deactivatedAt = null;
    }

    if (patch.keys !== undefined) {
      subscription.credentials = {
        p256dh: patch.keys.p256dh,
        auth: patch.keys.auth,
      };
    }

    if (patch.expirationTime !== undefined) {
      subscription.expirationTime = toExpirationDate(patch.expirationTime);
    }

    return this.subscriptions.save(subscription);
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
