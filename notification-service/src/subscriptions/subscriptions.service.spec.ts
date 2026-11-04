import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type {
  RegisterWebPushSubscriptionDto,
  UpdateWebPushSubscriptionDto,
} from './subscriptions.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const endpoint = 'https://fcm.googleapis.com/fcm/send/dV3n4X0EXAMPLE';
const input: RegisterWebPushSubscriptionDto = {
  endpoint,
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  expirationTime: null,
};

function repositoryMock() {
  return {
    findOne: vi.fn(),
    create: vi.fn((value: Partial<Subscription>) => ({ ...value })),
    save: vi.fn(async (value: Subscription) => value),
    update: vi.fn(async () => ({ affected: 0, raw: [] })),
  };
}

function serviceWith(repository: ReturnType<typeof repositoryMock>) {
  return new SubscriptionsService(
    repository as unknown as Repository<Subscription>,
  );
}

function existingRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'row-id',
    userId,
    channel: SubscriptionChannel.WebPush,
    endpoint,
    credentials: { p256dh: 'old', auth: 'old' },
    expirationTime: null,
    status: SubscriptionStatus.Active,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Subscription;
}

describe('SubscriptionsService', () => {
  describe('createWebPush', () => {
    it('inserts a new active web push subscription', async () => {
      const repository = repositoryMock();

      const subscription = await serviceWith(repository).createWebPush(
        userId,
        input,
      );

      expect(repository.create).toHaveBeenCalledWith({
        userId,
        channel: SubscriptionChannel.WebPush,
        endpoint,
        credentials: { p256dh: 'p256dh-value', auth: 'auth-value' },
        expirationTime: null,
        status: SubscriptionStatus.Active,
        deactivatedAt: null,
      });
      expect(subscription.status).toBe(SubscriptionStatus.Active);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('converts the browser expirationTime to a timestamp', async () => {
      const repository = repositoryMock();
      const expiresAt = Date.UTC(2026, 5, 1);

      const subscription = await serviceWith(repository).createWebPush(userId, {
        endpoint: input.endpoint,
        keys: input.keys,
        expirationTime: expiresAt,
      });

      expect(subscription.expirationTime).toEqual(new Date(expiresAt));
    });

    it('maps a duplicate pair to a conflict, including the insert race', async () => {
      const repository = repositoryMock();
      repository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT INTO subscriptions',
          [],
          Object.assign(new Error('duplicate key value'), { code: '23505' }),
        ),
      );

      await expect(
        serviceWith(repository).createWebPush(userId, input),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows unexpected persistence errors', async () => {
      const repository = repositoryMock();
      repository.save.mockRejectedValue(new Error('connection lost'));

      await expect(
        serviceWith(repository).createWebPush(userId, input),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('updateWebPush', () => {
    it('reactivates and refreshes an inactive row', async () => {
      const repository = repositoryMock();
      const row = existingRow({
        status: SubscriptionStatus.Inactive,
        deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      repository.findOne.mockResolvedValue(row);
      const patch: UpdateWebPushSubscriptionDto = {
        status: 'active',
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        expirationTime: Date.UTC(2026, 5, 1),
      };

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        patch,
      );

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId, endpoint },
      });
      expect(subscription.status).toBe(SubscriptionStatus.Active);
      expect(subscription.deactivatedAt).toBeNull();
      expect(subscription.credentials).toEqual({
        p256dh: 'new-p256dh',
        auth: 'new-auth',
      });
      expect(subscription.expirationTime).toEqual(
        new Date(Date.UTC(2026, 5, 1)),
      );
      expect(repository.save).toHaveBeenCalledWith(row);
    });

    it('applies only the fields present in the patch', async () => {
      const repository = repositoryMock();
      const row = existingRow();
      repository.findOne.mockResolvedValue(row);

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        { keys: { p256dh: 'rotated', auth: 'rotated-auth' } },
      );

      expect(subscription.credentials).toEqual({
        p256dh: 'rotated',
        auth: 'rotated-auth',
      });
      expect(subscription.status).toBe(SubscriptionStatus.Active);
    });

    it('clears the expiration when the patch sends null', async () => {
      const repository = repositoryMock();
      repository.findOne.mockResolvedValue(
        existingRow({ expirationTime: new Date('2026-05-01T00:00:00.000Z') }),
      );

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        { expirationTime: null },
      );

      expect(subscription.expirationTime).toBeNull();
    });

    it('rejects an endpoint with no stored row', async () => {
      const repository = repositoryMock();
      repository.findOne.mockResolvedValue(null);

      await expect(
        serviceWith(repository).updateWebPush(userId, endpoint, {
          status: 'active',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('deactivateWebPush', () => {
    it('marks the row inactive with a deactivation timestamp', async () => {
      const repository = repositoryMock();

      await serviceWith(repository).deactivateWebPush(userId, endpoint);

      expect(repository.update).toHaveBeenCalledWith(
        { userId, endpoint, status: SubscriptionStatus.Active },
        {
          status: SubscriptionStatus.Inactive,
          deactivatedAt: expect.any(Date),
        },
      );
    });

    it('treats an unknown endpoint as an idempotent success', async () => {
      const repository = repositoryMock();
      repository.update.mockResolvedValue({ affected: 0, raw: [] });

      await expect(
        serviceWith(repository).deactivateWebPush(userId, endpoint),
      ).resolves.toBeUndefined();
    });
  });
});
