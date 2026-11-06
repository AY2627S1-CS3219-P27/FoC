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
const otherUserId = '22222222-2222-4222-8222-222222222222';
const endpoint = 'https://fcm.googleapis.com/fcm/send/dV3n4X0EXAMPLE';
const input: RegisterWebPushSubscriptionDto = {
  endpoint,
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  expirationTime: null,
};

function duplicateKey(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO subscriptions',
    [],
    Object.assign(new Error('duplicate key value'), { code: '23505' }),
  );
}

function repositoryMock() {
  const repository = {
    findOne: vi.fn(),
    create: vi.fn((value: Partial<Subscription>) => ({ ...value })),
    save: vi.fn(async (value: Subscription) => value),
    update: vi.fn(async () => ({ affected: 0, raw: [] })),
    manager: {
      transaction: vi.fn(
        async (
          run: (manager: { getRepository: () => unknown }) => Promise<unknown>,
        ) => run({ getRepository: () => repository }),
      ),
    },
  };
  return repository;
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

    it('maps a duplicate pair for the same user to a conflict', async () => {
      const repository = repositoryMock();
      repository.save.mockRejectedValueOnce(duplicateKey());
      repository.findOne.mockResolvedValueOnce(existingRow());

      await expect(
        serviceWith(repository).createWebPush(userId, input),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('takes the endpoint over from another account', async () => {
      const repository = repositoryMock();
      repository.save.mockRejectedValueOnce(duplicateKey());
      repository.findOne.mockResolvedValueOnce(null);

      const subscription = await serviceWith(repository).createWebPush(
        userId,
        input,
      );

      expect(repository.update).toHaveBeenCalledWith(
        { endpoint, status: SubscriptionStatus.Active },
        {
          status: SubscriptionStatus.Inactive,
          deactivatedAt: expect.any(Date),
        },
      );
      expect(repository.create).toHaveBeenLastCalledWith({
        userId,
        channel: SubscriptionChannel.WebPush,
        endpoint,
        credentials: { p256dh: 'p256dh-value', auth: 'auth-value' },
        expirationTime: null,
        status: SubscriptionStatus.Active,
        deactivatedAt: null,
      });
      expect(subscription.userId).toBe(userId);
      expect(subscription.status).toBe(SubscriptionStatus.Active);
    });

    it('maps a takeover race to a conflict instead of a 500', async () => {
      const repository = repositoryMock();
      repository.save
        .mockRejectedValueOnce(duplicateKey())
        .mockRejectedValueOnce(duplicateKey());
      repository.findOne.mockResolvedValueOnce(null);

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
      repository.findOne.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
      const patch = {
        status: 'active',
        keys: { p256dh: 'new-p256dh', auth: 'new-auth' },
        expirationTime: Date.UTC(2026, 5, 1),
      } as UpdateWebPushSubscriptionDto;

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        patch,
      );

      expect(repository.findOne).toHaveBeenNthCalledWith(1, {
        where: { userId, endpoint },
        lock: { mode: 'pessimistic_write' },
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

    it('takes the endpoint back from the account that holds it', async () => {
      const repository = repositoryMock();
      const mine = existingRow({
        status: SubscriptionStatus.Inactive,
        deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const theirs = existingRow({ id: 'other-row', userId: otherUserId });
      repository.findOne
        .mockResolvedValueOnce(mine)
        .mockResolvedValueOnce(theirs);

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        { status: 'active' } as UpdateWebPushSubscriptionDto,
      );

      expect(theirs.status).toBe(SubscriptionStatus.Inactive);
      expect(theirs.deactivatedAt).toEqual(expect.any(Date));
      expect(repository.save).toHaveBeenCalledWith(theirs);
      expect(subscription.userId).toBe(userId);
      expect(subscription.status).toBe(SubscriptionStatus.Active);
      expect(subscription.deactivatedAt).toBeNull();
    });

    it('applies only the fields present in the patch', async () => {
      const repository = repositoryMock();
      const row = existingRow();
      repository.findOne.mockResolvedValue(row);

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        {
          keys: { p256dh: 'rotated', auth: 'rotated-auth' },
        } as UpdateWebPushSubscriptionDto,
      );

      expect(subscription.credentials).toEqual({
        p256dh: 'rotated',
        auth: 'rotated-auth',
      });
      expect(subscription.status).toBe(SubscriptionStatus.Active);
      // Without `status` there is nothing to reactivate, so no second lookup.
      expect(repository.findOne).toHaveBeenCalledTimes(1);
    });

    it('clears the expiration when the patch sends null', async () => {
      const repository = repositoryMock();
      repository.findOne.mockResolvedValue(
        existingRow({ expirationTime: new Date('2026-05-01T00:00:00.000Z') }),
      );

      const subscription = await serviceWith(repository).updateWebPush(
        userId,
        endpoint,
        { expirationTime: null } as UpdateWebPushSubscriptionDto,
      );

      expect(subscription.expirationTime).toBeNull();
    });

    it('rejects an endpoint with no stored row', async () => {
      const repository = repositoryMock();
      repository.findOne.mockResolvedValue(null);

      await expect(
        serviceWith(repository).updateWebPush(userId, endpoint, {
          status: 'active',
        } as UpdateWebPushSubscriptionDto),
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
