import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import type { Repository } from 'typeorm';
import {
  Notification,
  NotificationContent,
  NotificationStatus,
} from '../database/entities/notification.entity.js';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import type { NotifyMessagePublisher } from '../messaging/process-outcome.js';
import {
  NOTIFY_RETRY_ROUTING_KEY,
  NOTIFY_ROUTING_KEY,
} from '../messaging/topology.js';
import type { NotificationSender } from './notification.sender.js';
import {
  NotifyTransformerRegistry,
  type NotifyEventTransformer,
} from './notify-transformer.registry.js';
import { NotifyHandler } from './notify.handler.js';

const userId = '11111111-1111-4111-8111-111111111111';
const notificationGuid = '44444444-4444-4444-8444-444444444444';
const content: NotificationContent = {
  title: 'Errand accepted',
  body: 'Your errand was accepted by a courier.',
};

const subscription = (overrides: Partial<Subscription> = {}): Subscription =>
  ({
    id: '22222222-2222-4222-8222-222222222222',
    userId,
    channel: SubscriptionChannel.WebPush,
    endpoint: 'https://fcm.googleapis.com/fcm/send/endpoint-a',
    credentials: { p256dh: 'p', auth: 'a' },
    expirationTime: null,
    status: SubscriptionStatus.Active,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Subscription;

const row = (overrides: Partial<Notification> = {}): Notification =>
  ({
    id: '55555555-5555-4555-8555-555555555555',
    guid: notificationGuid,
    subscriptionId: subscription().id,
    attemptCount: 1,
    status: NotificationStatus.Pending,
    content,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Notification;

const notifyEvent = (overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  eventType: 'NotificationNotify',
  timestamp: '2026-10-11T08:30:00.000Z',
  publisher: 'notification-service',
  payload: { notificationGuid, userId, content },
  ...overrides,
});

function setup(
  options: { transformers?: Map<string, NotifyEventTransformer> } = {},
) {
  const insertQuery = {
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn(async () => undefined),
  };

  const notifications = {
    findOne: vi.fn(),
    save: vi.fn(async (value: Notification) => value),
    createQueryBuilder: vi.fn(() => insertQuery),
  };
  const subscriptions = {
    find: vi.fn(async () => [] as Subscription[]),
    findOne: vi.fn(),
  };
  const sender = { send: vi.fn(async () => undefined) };
  const publisher = {
    publishNotifyRetry: vi.fn(async () => undefined),
    publishDeadLetter: vi.fn(async () => undefined),
  } satisfies NotifyMessagePublisher;

  const handler = new NotifyHandler(
    notifications as unknown as Repository<Notification>,
    subscriptions as unknown as Repository<Subscription>,
    sender as NotificationSender,
    new AccountEventContractValidator(),
    new NotifyTransformerRegistry(
      options.transformers ?? new Map<string, NotifyEventTransformer>(),
    ),
  );

  return {
    handler,
    notifications,
    subscriptions,
    sender,
    publisher,
    insertQuery,
  };
}

describe('NotifyHandler', () => {
  describe('canonical fan-out', () => {
    it('creates one row and one delivery per active subscription', async () => {
      const {
        handler,
        subscriptions,
        notifications,
        sender,
        insertQuery,
        publisher,
      } = setup();
      subscriptions.find.mockResolvedValue([
        subscription(),
        subscription({
          id: '33333333-3333-4333-8333-333333333333',
          endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/b',
        }),
      ]);
      notifications.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          row({ subscriptionId: '33333333-3333-4333-8333-333333333333' }),
        );

      const outcome = await handler.handle(
        { body: notifyEvent(), routingKey: NOTIFY_ROUTING_KEY, attempt: 1 },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(subscriptions.find).toHaveBeenCalledWith({
        where: { userId, status: SubscriptionStatus.Active },
      });
      expect(insertQuery.execute).toHaveBeenCalledTimes(2);
      expect(insertQuery.values).toHaveBeenCalledWith(
        expect.objectContaining({
          guid: notificationGuid,
          subscriptionId: subscription().id,
          attemptCount: 1,
          status: NotificationStatus.Pending,
          content,
        }),
      );
      expect(sender.send).toHaveBeenCalledTimes(2);
      expect(sender.send).toHaveBeenCalledWith(expect.anything(), content);
    });

    it('skips rows that are already delivered or awaiting a retry', async () => {
      const { handler, subscriptions, notifications, sender, publisher } =
        setup();
      subscriptions.find.mockResolvedValue([subscription()]);
      notifications.findOne.mockResolvedValue(
        row({ status: NotificationStatus.Delivered }),
      );

      const outcome = await handler.handle(
        { body: notifyEvent(), routingKey: NOTIFY_ROUTING_KEY, attempt: 1 },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('re-attempts a pending first-attempt row left by a crash', async () => {
      const { handler, subscriptions, notifications, sender, publisher } =
        setup();
      subscriptions.find.mockResolvedValue([subscription()]);
      notifications.findOne.mockResolvedValue(row());

      await handler.handle(
        { body: notifyEvent(), routingKey: NOTIFY_ROUTING_KEY, attempt: 1 },
        publisher,
      );

      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('marks the row delivered on success', async () => {
      const { handler, subscriptions, notifications, publisher } = setup();
      subscriptions.find.mockResolvedValue([subscription()]);
      notifications.findOne.mockResolvedValue(row());

      await handler.handle(
        { body: notifyEvent(), routingKey: NOTIFY_ROUTING_KEY, attempt: 1 },
        publisher,
      );

      expect(notifications.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NotificationStatus.Delivered }),
      );
    });

    it('schedules attempt 2 when the first delivery fails', async () => {
      const { handler, subscriptions, notifications, sender, publisher } =
        setup();
      subscriptions.find.mockResolvedValue([subscription()]);
      notifications.findOne.mockResolvedValue(row());
      sender.send.mockRejectedValue(new Error('push service unavailable'));

      const outcome = await handler.handle(
        { body: notifyEvent(), routingKey: NOTIFY_ROUTING_KEY, attempt: 1 },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(publisher.publishNotifyRetry).toHaveBeenCalledWith(
        { notificationGuid, subscriptionId: subscription().id },
        2,
      );
      expect(notifications.save).toHaveBeenCalledWith(
        expect.objectContaining({ attemptCount: 2 }),
      );
    });

    it('drops an event that is neither canonical nor translatable', async () => {
      const { handler, subscriptions, publisher } = setup();

      const outcome = await handler.handle(
        {
          body: { not: 'a notification' },
          routingKey: NOTIFY_ROUTING_KEY,
          attempt: 1,
        },
        publisher,
      );

      expect(outcome).toMatchObject({ action: 'dropped' });
      expect(subscriptions.find).not.toHaveBeenCalled();
    });

    it('coerces a registered upstream event through its transformer', async () => {
      const translate = vi.fn(() => ({
        notificationGuid,
        userId,
        content,
      }));
      const transformer: NotifyEventTransformer = { translate };
      const { handler, subscriptions, notifications, sender, publisher } =
        setup({
          transformers: new Map([['order.errand-accepted.v1', transformer]]),
        });
      subscriptions.find.mockResolvedValue([subscription()]);
      notifications.findOne.mockResolvedValue(row());

      const outcome = await handler.handle(
        {
          body: { eventType: 'ErrandAccepted' },
          routingKey: 'order.errand-accepted.v1',
          attempt: 1,
        },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(translate).toHaveBeenCalledWith({
        eventType: 'ErrandAccepted',
      });
      expect(sender.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-pair retry (NS3.1 guards)', () => {
    it('drops a retry whose pair does not exist (NS3.1.1)', async () => {
      const { handler, notifications, sender, publisher } = setup();
      notifications.findOne.mockResolvedValue(null);

      const outcome = await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 2,
        },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('drops a stale retry whose attempt does not match (NS3.1.2)', async () => {
      const { handler, notifications, sender, publisher } = setup();
      notifications.findOne.mockResolvedValue(row({ attemptCount: 3 }));

      const outcome = await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 2,
        },
        publisher,
      );

      expect(outcome).toEqual({ action: 'acked' });
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('never re-sends a delivered pair', async () => {
      const { handler, notifications, sender, publisher } = setup();
      notifications.findOne.mockResolvedValue(
        row({ status: NotificationStatus.Delivered }),
      );

      await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 1,
        },
        publisher,
      );

      expect(sender.send).not.toHaveBeenCalled();
    });

    it('delivers when the attempt matches and the pair is pending', async () => {
      const { handler, notifications, subscriptions, sender, publisher } =
        setup();
      notifications.findOne.mockResolvedValue(row({ attemptCount: 2 }));
      subscriptions.findOne.mockResolvedValue(subscription());

      await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 2,
        },
        publisher,
      );

      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(notifications.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NotificationStatus.Delivered }),
      );
    });

    it('fails permanently and dead-letters on the final attempt', async () => {
      const { handler, notifications, subscriptions, sender, publisher } =
        setup();
      notifications.findOne.mockResolvedValue(row({ attemptCount: 5 }));
      subscriptions.findOne.mockResolvedValue(subscription());
      sender.send.mockRejectedValue(new Error('endpoint gone'));

      await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 5,
        },
        publisher,
      );

      expect(publisher.publishNotifyRetry).not.toHaveBeenCalled();
      expect(publisher.publishDeadLetter).toHaveBeenCalledWith(
        { notificationGuid, subscriptionId: subscription().id },
        NOTIFY_RETRY_ROUTING_KEY,
        'endpoint gone',
      );
      expect(notifications.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NotificationStatus.Failed }),
      );
    });

    it('fails the row when the subscription is no longer active', async () => {
      const { handler, notifications, subscriptions, sender, publisher } =
        setup();
      notifications.findOne.mockResolvedValue(row({ attemptCount: 2 }));
      subscriptions.findOne.mockResolvedValue(
        subscription({ status: SubscriptionStatus.Inactive }),
      );

      await handler.handle(
        {
          body: { notificationGuid, subscriptionId: subscription().id },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 2,
        },
        publisher,
      );

      expect(sender.send).not.toHaveBeenCalled();
      expect(notifications.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NotificationStatus.Failed }),
      );
    });

    it('drops a malformed retry body', async () => {
      const { handler, notifications, publisher } = setup();

      const outcome = await handler.handle(
        {
          body: { notificationGuid: 'not-a-uuid' },
          routingKey: NOTIFY_RETRY_ROUTING_KEY,
          attempt: 2,
        },
        publisher,
      );

      expect(outcome).toMatchObject({ action: 'dropped' });
      expect(notifications.findOne).not.toHaveBeenCalled();
    });
  });

  it('drops a delivery on an unexpected routing key', async () => {
    const { handler, publisher } = setup();

    const outcome = await handler.handle(
      { body: {}, routingKey: 'order.errand-accepted.v1', attempt: 1 },
      publisher,
    );

    expect(outcome).toMatchObject({ action: 'dropped' });
  });
});
