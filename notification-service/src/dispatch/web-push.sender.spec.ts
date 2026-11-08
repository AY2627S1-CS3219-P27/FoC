import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/index.js';
import type { Subscription } from '../database/entities/index.js';
import {
  isExpiredSubscriptionError,
  WebPushSender,
} from './web-push.sender.js';

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
}));

const subscription = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  channel: SubscriptionChannel.WebPush,
  endpoint: 'https://push.example.test/abc',
  credentials: { p256dh: 'p256dh-key', auth: 'auth-key' },
  expirationTime: null,
  status: SubscriptionStatus.Active,
} as Subscription;

const message = {
  title: 'Errand delivered',
  body: 'Your errand has been delivered.',
  tag: '33333333-3333-4333-8333-333333333333',
  url: '/home',
};

function createSender(): WebPushSender {
  return new WebPushSender(
    { getOrThrow: (key: string) => `value:${key}` } as never,
    { getVapidPrivateKey: () => 'private-key' } as never,
  );
}

describe('WebPushSender', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    setVapidDetails.mockReset();
  });

  it('configures VAPID details from config and the mounted secret', () => {
    createSender();

    expect(setVapidDetails).toHaveBeenCalledWith(
      'value:VAPID_SUBJECT',
      'value:VAPID_PUBLIC_KEY',
      'private-key',
    );
  });

  it('sends the JSON message to the stored endpoint and keys', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sender = createSender();

    await expect(sender.send(subscription, message)).resolves.toBe('sent');

    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        expirationTime: null,
        keys: subscription.credentials,
      },
      JSON.stringify(message),
      { TTL: 3600 },
    );
  });

  it.each([404, 410])(
    'treats HTTP %i as an expired subscription',
    async (statusCode) => {
      sendNotification.mockRejectedValue(
        Object.assign(new Error('gone'), { statusCode }),
      );

      await expect(createSender().send(subscription, message)).resolves.toBe(
        'expired',
      );
    },
  );

  it('rethrows transient push failures for the transport to retry', async () => {
    sendNotification.mockRejectedValue(
      Object.assign(new Error('unavailable'), { statusCode: 503 }),
    );

    await expect(createSender().send(subscription, message)).rejects.toThrow(
      'unavailable',
    );
  });
});

describe('isExpiredSubscriptionError', () => {
  it('only recognizes revoked-subscription status codes', () => {
    expect(isExpiredSubscriptionError({ statusCode: 404 })).toBe(true);
    expect(isExpiredSubscriptionError({ statusCode: 410 })).toBe(true);
    expect(isExpiredSubscriptionError({ statusCode: 500 })).toBe(false);
    expect(isExpiredSubscriptionError(new Error('no status'))).toBe(false);
  });
});
