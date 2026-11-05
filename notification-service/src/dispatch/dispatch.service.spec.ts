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
  const deliveryFind = vi.fn();
  const deliveryUpdate = vi.fn();
  const findActiveWebPush = vi.fn();
  const deactivateWebPush = vi.fn();
  const send = vi.fn();

  const deliveryRepository = {
    find: deliveryFind,
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
    }),
  };
  const dataSource = {
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
      deliveryFind.mockResolvedValue([delivery()]);
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
      deliveryFind.mockResolvedValue([delivery()]);
      send.mockResolvedValue('expired');

      await service.deliverPending(event.eventId);

      expect(deactivateWebPush).toHaveBeenCalledWith(
        event.payload.requesterUserId,
        endpoint,
      );
      expect(deliveryUpdate).toHaveBeenCalledWith(
        delivery().id,
        expect.objectContaining({
          status: NotificationDeliveryStatus.Abandoned,
        }),
      );
    });

    it('abandons a delivery whose subscription is no longer active', async () => {
      deliveryFind.mockResolvedValue([
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
      deliveryFind.mockResolvedValue([delivery()]);
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
  });
});
