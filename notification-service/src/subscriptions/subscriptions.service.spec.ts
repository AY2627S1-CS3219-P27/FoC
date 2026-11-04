import { QueryFailedError, type Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type { RegisterWebPushSubscriptionDto } from './subscriptions.dto.js';
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
    findOneOrFail: vi.fn(),
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

describe('SubscriptionsService', () => {
  it('inserts a new active web push subscription', async () => {
    const repository = repositoryMock();
    repository.findOne.mockResolvedValue(null);

    const result = await serviceWith(repository).registerWebPush(userId, input);

    expect(result.created).toBe(true);
    expect(repository.create).toHaveBeenCalledWith({
      userId,
      channel: SubscriptionChannel.WebPush,
      endpoint,
      credentials: { p256dh: 'p256dh-value', auth: 'auth-value' },
      expirationTime: null,
      status: SubscriptionStatus.Active,
      deactivatedAt: null,
    });
    expect(result.subscription.status).toBe(SubscriptionStatus.Active);
    expect(result.subscription.channel).toBe(SubscriptionChannel.WebPush);
  });

  it('converts the browser expirationTime to a timestamp', async () => {
    const repository = repositoryMock();
    repository.findOne.mockResolvedValue(null);
    const expiresAt = Date.UTC(2026, 5, 1);

    const result = await serviceWith(repository).registerWebPush(userId, {
      endpoint: input.endpoint,
      keys: input.keys,
      expirationTime: expiresAt,
    });

    expect(result.subscription.expirationTime).toEqual(new Date(expiresAt));
  });

  it('reactivates and refreshes an inactive row instead of inserting', async () => {
    const repository = repositoryMock();
    const existing = {
      id: 'row-id',
      userId,
      channel: SubscriptionChannel.WebPush,
      endpoint,
      credentials: { p256dh: 'old', auth: 'old' },
      expirationTime: null,
      status: SubscriptionStatus.Inactive,
      deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as Subscription;
    repository.findOne.mockResolvedValue(existing);
    repository.findOneOrFail.mockResolvedValue(existing);

    const result = await serviceWith(repository).registerWebPush(userId, input);

    expect(result.created).toBe(false);
    expect(repository.create).not.toHaveBeenCalled();
    expect(result.subscription.status).toBe(SubscriptionStatus.Active);
    expect(result.subscription.deactivatedAt).toBeNull();
    expect(result.subscription.credentials).toEqual({
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    });
  });

  it('refreshes an active row in place (key rotation)', async () => {
    const repository = repositoryMock();
    const existing = {
      id: 'row-id',
      userId,
      channel: SubscriptionChannel.WebPush,
      endpoint,
      credentials: { p256dh: 'old', auth: 'old' },
      expirationTime: null,
      status: SubscriptionStatus.Active,
      deactivatedAt: null,
    } as Subscription;
    repository.findOne.mockResolvedValue(existing);
    repository.findOneOrFail.mockResolvedValue(existing);

    const result = await serviceWith(repository).registerWebPush(userId, input);

    expect(result.created).toBe(false);
    expect(result.subscription.credentials).toEqual({
      p256dh: 'p256dh-value',
      auth: 'auth-value',
    });
    expect(repository.save).toHaveBeenCalledWith(existing);
  });

  it('falls back to a refresh when a concurrent insert wins the unique key', async () => {
    const repository = repositoryMock();
    repository.findOne.mockResolvedValue(null);
    const uniqueViolation = new QueryFailedError(
      'INSERT INTO subscriptions',
      [],
      Object.assign(new Error('duplicate key value'), { code: '23505' }),
    );
    repository.save.mockRejectedValueOnce(uniqueViolation);
    const existing = {
      id: 'row-id',
      userId,
      channel: SubscriptionChannel.WebPush,
      endpoint,
      credentials: { p256dh: 'winner', auth: 'winner' },
      expirationTime: null,
      status: SubscriptionStatus.Active,
      deactivatedAt: null,
    } as Subscription;
    repository.findOneOrFail.mockResolvedValue(existing);

    const result = await serviceWith(repository).registerWebPush(userId, input);

    expect(result.created).toBe(false);
    expect(repository.findOneOrFail).toHaveBeenCalledWith({
      where: { userId, endpoint },
    });
  });

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
