import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  type DeepPartial,
  type EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
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

function registrationFields(
  userId: string,
  input: RegisterWebPushSubscriptionDto,
): DeepPartial<Subscription> {
  return {
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
  };
}

function alreadyExists(): ConflictException {
  return new ConflictException({
    code: 'SUBSCRIPTION_ALREADY_EXISTS',
    message: 'A subscription for this endpoint already exists',
  });
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  /**
   * Active Web Push destinations for the given users, in one query.
   *
   * Dispatch fan-out reads subscriptions through this method rather than
   * reaching into the table: the subscriptions module stays the only owner of
   * its schema and status rules.
   */
  async findActiveWebPush(userIds: readonly string[]): Promise<Subscription[]> {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    return this.subscriptions.find({
      where: {
        userId: In(uniqueUserIds),
        channel: SubscriptionChannel.WebPush,
        status: SubscriptionStatus.Active,
      },
    });
  }

  /**
   * Inserts a new subscription for `(userId, endpoint)`.
   *
   * A pair that already exists for this user is a conflict: re-presenting a
   * subscription is a PATCH, not another create. The unique-violation race (two
   * tabs registering the same endpoint) maps to the same conflict.
   *
   * The endpoint belongs to the browser, not the account, so a violation may
   * also mean another account is signed in elsewhere on the same browser. That
   * case is resolved by taking the endpoint over — see `reconcileWebPush`.
   *
   * When the browser re-issued its subscription (`pushsubscriptionchange`), the
   * client presents the stale endpoints with the new one and the rotation
   * applies atomically instead — see `rotateWebPush`.
   */
  async createWebPush(
    userId: string,
    input: RegisterWebPushSubscriptionDto,
  ): Promise<Subscription> {
    const previousEndpoints = this.previousEndpointsOf(input);
    if (previousEndpoints.length > 0) {
      return this.rotateWebPush(userId, input, previousEndpoints);
    }

    const created = this.subscriptions.create(
      registrationFields(userId, input),
    );

    try {
      return await this.subscriptions.save(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.reconcileWebPush(userId, input);
      }
      throw error;
    }
  }

  /**
   * The stale endpoints a rotation POST asks the service to deactivate: present,
   * deduplicated, and never the new endpoint itself (an entry equal to it is a
   * re-registration, not a rotation).
   */
  private previousEndpointsOf(
    input: RegisterWebPushSubscriptionDto,
  ): string[] {
    const previous = input.previousEndpoints;
    if (!Array.isArray(previous)) return [];
    return [
      ...new Set(
        previous.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' &&
            candidate !== '' &&
            candidate !== input.endpoint,
        ),
      ),
    ];
  }

  /**
   * Rotation: the browser re-issued its subscription and the push service
   * handed back a new endpoint. Deactivate every previous `(userId, endpoint)`
   * row and store the new endpoint in a single transaction, so no moment exists
   * where the user has neither a live destination nor a stale one still
   * receiving deliveries. If the new endpoint is owned by another account on a
   * shared browser, the takeover deactivation runs inside the same transaction
   * (NS6.2).
   *
   * The rotation is idempotent: an endpoint the caller already registered
   * (active or soft-deleted) is reactivated with the fresh credentials rather
   * than reported as a conflict — a `409` would push the client onto PATCH,
   * which cannot carry the stale endpoints, and leave them active.
   *
   * A failed statement aborts the whole transaction in Postgres, so a
   * unique-violation race cannot be recovered inside it: the transaction rolls
   * back and the rotation is retried against the committed state, where the
   * existing-row path above resolves it. Only after the retry budget is spent
   * does the request surface as a conflict.
   */
  private async rotateWebPush(
    userId: string,
    input: RegisterWebPushSubscriptionDto,
    previousEndpoints: readonly string[],
  ): Promise<Subscription> {
    const rotationAttempts = 3;
    for (let attempt = 0; attempt < rotationAttempts; attempt += 1) {
      try {
        return await this.subscriptions.manager.transaction(async (manager) => {
          const repository = manager.getRepository(Subscription);

          // NS6.2.1 — deactivate the stale endpoints (idempotent: a missing or
          // already-inactive row is a no-op).
          for (const previousEndpoint of previousEndpoints) {
            await this.deactivateWebPush(userId, previousEndpoint, manager);
          }

          // NS6.2.2 — the new endpoint may already belong to this user (a
          // concurrent sync, or a retry after a lost race below): reactivate it
          // with the fresh credentials instead of inserting.
          const existing = await repository.findOne({
            where: { userId, endpoint: input.endpoint },
          });
          if (existing !== null) {
            existing.status = SubscriptionStatus.Active;
            existing.deactivatedAt = null;
            existing.credentials = {
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
            };
            existing.expirationTime = toExpirationDate(input.expirationTime);
            return repository.save(existing);
          }

          // NS6.2.3 — another account holds the new endpoint's live
          // subscription on this browser: the endpoint changes hands.
          await repository.update(
            { endpoint: input.endpoint, status: SubscriptionStatus.Active },
            { status: SubscriptionStatus.Inactive, deactivatedAt: new Date() },
          );

          return repository.save(
            repository.create(registrationFields(userId, input)),
          );
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw alreadyExists();
  }

  /**
   * Resolves the unique violation from `createWebPush`.
   *
   * If the caller already has a row for the endpoint (active or soft-deleted),
   * the insert is a genuine conflict and the client reconciles with PATCH.
   * Otherwise another account holds the live subscription for this browser's
   * endpoint: the endpoint changes hands, because whoever is signed in now owns
   * its notifications. Deactivating the old row and inserting the caller's
   * happen in one transaction, so no moment exists where two accounts own the
   * same endpoint.
   */
  private async reconcileWebPush(
    userId: string,
    input: RegisterWebPushSubscriptionDto,
  ): Promise<Subscription> {
    try {
      return await this.subscriptions.manager.transaction(async (manager) => {
        const repository = manager.getRepository(Subscription);

        const mine = await repository.findOne({
          where: { userId, endpoint: input.endpoint },
        });
        if (mine !== null) {
          throw alreadyExists();
        }

        await repository.update(
          {
            endpoint: input.endpoint,
            status: SubscriptionStatus.Active,
          },
          {
            status: SubscriptionStatus.Inactive,
            deactivatedAt: new Date(),
          },
        );

        return repository.save(
          repository.create(registrationFields(userId, input)),
        );
      });
    } catch (error) {
      // A simultaneous registration won the endpoint between the failed insert
      // and this transaction. Reporting a conflict lets the client retry
      // through its normal POST-then-PATCH path.
      if (isUniqueViolation(error)) {
        throw alreadyExists();
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
   *
   * Reactivating also hands the endpoint back if another account took it over
   * while this row was inactive (the browser was signed in as someone else);
   * that account's live row is deactivated in the same transaction.
   */
  async updateWebPush(
    userId: string,
    endpoint: string,
    patch: UpdateWebPushSubscriptionDto,
  ): Promise<Subscription> {
    return this.subscriptions.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Subscription);

      const subscription = await repository.findOne({
        where: { userId, endpoint },
        lock: { mode: 'pessimistic_write' },
      });

      if (subscription === null) {
        throw new NotFoundException({
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: 'No subscription exists for this endpoint',
        });
      }

      if (patch.status !== undefined) {
        const active = await repository.findOne({
          where: { endpoint, status: SubscriptionStatus.Active },
        });
        if (active !== null && active.userId !== userId) {
          active.status = SubscriptionStatus.Inactive;
          active.deactivatedAt = new Date();
          await repository.save(active);
        }

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

      return repository.save(subscription);
    });
  }

  /**
   * Soft-deletes the `(userId, endpoint)` row (FR NS5.2).
   *
   * Idempotent by design: an unknown endpoint, someone else's endpoint and an
   * already-inactive row all succeed without changing anything.
   *
   * `manager` lets a caller join the deactivation into its own transaction.
   * Dispatch holds the subscription row's lock for the duration of a push, so
   * deactivating an expired endpoint mid-dispatch must run on that transaction
   * - a standalone update would wait on the dispatch's own lock.
   */
  async deactivateWebPush(
    userId: string,
    endpoint: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repository =
      manager?.withRepository(this.subscriptions) ?? this.subscriptions;
    await repository.update(
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
