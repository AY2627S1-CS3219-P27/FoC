import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrandDeliveredEvent } from '@foc/contracts';
import {
  NotificationDeliveryStatus,
  SubscriptionStatus,
} from '../database/entities/index.js';
import type { NotificationDelivery as Delivery } from '../database/entities/index.js';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { DispatchService } from './dispatch.service.js';
import type { WebPushSender } from './web-push.sender.js';

const event: ErrandDeliveredEvent = {
  eventId: '33333333-3333-4333-8333-333333333333',
  eventType: 'ErrandDelivered',
  timestamp: '2026-11-05T09:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: '44444444-4444-4444-8444-444444444444',
    requesterUserId: '11111111-1111-4111-8111-111111111111',
    courierUserId: '22222222-2222-4222-8222-222222222222',
  },
};

const message = {
  title: 'Errand delivered',
  body: 'Your errand has been delivered.',
  tag: event.eventId,
  url: '/home',
};

const endpoint = 'https://push.example.test/abc';

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    eventId: event.eventId,
    subscriptionId: '66666666-6666-4666-8666-666666666666',
    userId: event.payload.requesterUserId,
    status: NotificationDeliveryStatus.Pending,
    message,
    attempts: 1,
    lastError: null,
    sentAt: null,
    subscription: {
      id: '66666666-6666-4666-8666-666666666666',
      userId: event.payload.requesterUserId,
      endpoint,
      status: SubscriptionStatus.Active,
    },
    ...overrides,
  } as Delivery;
}

describe('DispatchService', () => {
  const insertValues = vi.fn();
  const insertExecute = vi.fn();
  const deliveryGetMany = vi.fn();
  const deliveryUpdate = vi.fn();
  const findActiveWebPush = vi.fn();
  const deactivateWebPush = vi.fn();
  const send = vi.fn();

  // Chained select methods of the claim query, ending in getMany.
  const claimBuilder = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    getMany: deliveryGetMany,
  };
  const deliveryRepository = {
    update: deliveryUpdate,
    createQueryBuilder: () => ({
      insert: () => ({
        into: () => ({
          values: (rows: unknown) => {
            insertValues(rows);
            return { orIgnore: () => ({ execute: insertExecute }) };
          },
        }),
      }),
      ...claimBuilder,
    }),
  };
  const manager = {
    getRepository: () => deliveryRepository,
  };
  const dataSource = {
    transaction: vi.fn(
      async (run: (m: typeof manager) => Promise<unknown>) => run(manager),
    ),
    getRepository: () => deliveryRepository,
  };

  const webPush = { send } as unknown as WebPushSender;
  const subscriptions = {
    findActiveWebPush,
    deactivateWebPush,
  } as unknown as SubscriptionsService;

  let service: DispatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DispatchService(dataSource as never, webPush, subscriptions);
  });

  describe('enqueue', () => {
    it('does nothing when the event has no recipients', async () => {
      await service.enqueue(event, { recipients: [], message });

      expect(findActiveWebPush).not.toHaveBeenCalled();
    });

    it('asks the subscriptions module for each unique recipient once', async () => {
      findActiveWebPush.mockResolvedValue([]);

      await service.enqueue(event, {
        recipients: [
          event.payload.requesterUserId,
          event.payload.requesterUserId,
          event.payload.courierUserId,
        ],
        message,
      });

      expect(findActiveWebPush).toHaveBeenCalledWith([
        event.payload.requesterUserId,
        event.payload.courierUserId,
      ]);
    });

    it('inserts one pending row per active subscription, ignoring duplicates', async () => {
      findActiveWebPush.mockResolvedValue([
        { id: 'a', userId: event.payload.requesterUserId },
        { id: 'b', userId: event.payload.courierUserId },
      ]);

      await service.enqueue(event, {
        recipients: [event.payload.requesterUserId],
        message,
      });

      expect(insertValues).toHaveBeenCalledWith([
        expect.objectContaining({
          eventId: event.eventId,
          subscriptionId: 'a',
          status: NotificationDeliveryStatus.Pending,
          message,
        }),
        expect.objectContaining({
          eventId: event.eventId,
          subscriptionId: 'b',
          status: NotificationDeliveryStatus.Pending,
          message,
        }),
      ]);
      expect(insertExecute).toHaveBeenCalled();
    });

    it('writes nothing when no subscription is active', async () => {
      findActiveWebPush.mockResolvedValue([]);

      await service.enqueue(event, {
        recipients: [event.payload.requesterUserId],
        message,
      });

      expect(insertValues).not.toHaveBeenCalled();
    });
  });

  describe('deliverPending', () => {
    it('sends the persisted message and marks the delivery sent', async () => {
      deliveryGetMany.mockResolvedValue([delivery()]);
      send.mockResolvedValue('sent');

      await service.deliverPending(event.eventId);

      expect(send).toHaveBeenCalledWith(delivery().subscription, message);
      expect(deliveryUpdate).toHaveBeenCalledWith(
        delivery().id,
        expect.objectContaining({
          status: NotificationDeliveryStatus.Sent,
          attempts: 2,
        }),
      );
    });

    it('deactivates an expired subscription through its service', async () => {
      deliveryGetMany.mockResolvedValue([delivery()]);
      send.mockResolvedValue('expired');

      await service.deliverPending(event.eventId);

      expect(deactivateWebPush).toHaveBeenCalledWith(
        event.payload.requesterUserId,
        endpoint,
        manager,
      );
      expect(deliveryUpdate).toHaveBeenCalledWith(
        delivery().id,
        expect.objectContaining({
          status: NotificationDeliveryStatus.Abandoned,
        }),
      );
    });

    it('abandons a delivery whose subscription is no longer active', async () => {
      deliveryGetMany.mockResolvedValue([
        delivery({
          subscription: {
            id: '66666666-6666-4666-8666-666666666666',
            status: SubscriptionStatus.Inactive,
          } as never,
        }),
      ]);

      await service.deliverPending(event.eventId);

      expect(send).not.toHaveBeenCalled();
      expect(deactivateWebPush).not.toHaveBeenCalled();
      expect(deliveryUpdate).toHaveBeenCalledWith(
        delivery().id,
        expect.objectContaining({
          status: NotificationDeliveryStatus.Abandoned,
        }),
      );
    });

    it('records a transient failure and rethrows for transport retry', async () => {
      deliveryGetMany.mockResolvedValue([delivery()]);
      send.mockRejectedValue(new Error('push unavailable'));

      await expect(service.deliverPending(event.eventId)).rejects.toThrow(
        'push unavailable',
      );

      expect(deliveryUpdate).toHaveBeenCalledWith(
        delivery().id,
        expect.objectContaining({
          attempts: 2,
          lastError: 'push unavailable',
        }),
      );
    });

    it('claims the pending rows with a pessimistic write lock', async () => {
      deliveryGetMany.mockResolvedValue([]);

      await service.deliverPending(event.eventId);

      expect(claimBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(claimBuilder.innerJoinAndSelect).toHaveBeenCalledWith(
        'delivery.subscription',
        'subscription',
      );
    });

    it('keeps earlier sent marks when a later delivery fails transiently', async () => {
      const first = delivery({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const second = delivery({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      deliveryGetMany.mockResolvedValue([first, second]);
      send
        .mockResolvedValueOnce('sent')
        .mockRejectedValueOnce(new Error('push unavailable'));

      await expect(service.deliverPending(event.eventId)).rejects.toThrow(
        'push unavailable',
      );

      expect(deliveryUpdate).toHaveBeenCalledWith(
        first.id,
        expect.objectContaining({ status: NotificationDeliveryStatus.Sent }),
      );
      expect(deliveryUpdate).toHaveBeenCalledWith(
        second.id,
        expect.objectContaining({
          attempts: 2,
          lastError: 'push unavailable',
        }),
      );
    });
  });
});
