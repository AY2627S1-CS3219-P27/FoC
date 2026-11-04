import {
  AccountEventContractValidator,
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
} from '@foc/contracts';
import type { IncomingLifecycleMessage } from '../messaging/rabbitmq-message.types.js';
import { LifecycleIngestionService } from './lifecycle-ingestion.service.js';
import { LifecycleMessageDispatcher } from './lifecycle-message.handler.js';

const ids = {
  eventId: '98f5905c-2cd6-4e4c-b3d2-eaa87440af87',
  errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61',
  requesterUserId: '21e66a66-257f-4a64-b059-46d353ec21c6',
  courierUserId: 'ea1d20b3-dc12-4498-b750-967c86d74023',
};

function incoming(
  routingKey: string,
  eventType: string,
  payload: Record<string, unknown>,
): IncomingLifecycleMessage {
  const body = {
    eventId: ids.eventId,
    eventType,
    timestamp: '2026-11-04T00:00:00.000Z',
    publisher: 'order-service',
    payload,
  };
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    routingKey,
    eventId: ids.eventId,
    retryCount: 0,
  };
}

function harness() {
  const process = vi.fn().mockResolvedValue({
    status: 'recorded',
    eventId: ids.eventId,
  });
  const ingestion = { process } as unknown as LifecycleIngestionService;
  const dispatcher = new LifecycleMessageDispatcher(
    new AccountEventContractValidator(),
    ingestion,
  );
  return { dispatcher, process };
}

describe('LifecycleMessageDispatcher', () => {
  it.each([
    [
      ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
      'ErrandAccepted',
      { ...ids, eventId: undefined },
    ],
    [
      ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
      'ErrandDelivered',
      { ...ids, eventId: undefined },
    ],
    [
      ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
      'CourierCancelled',
      { ...ids, eventId: undefined },
    ],
    [
      ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
      'ErrandCancelled',
      { errandId: ids.errandId },
    ],
  ])('validates and records %s', async (routingKey, eventType, payload) => {
    const { dispatcher, process } = harness();
    delete payload.eventId;
    const message = incoming(routingKey, eventType, payload);

    await expect(dispatcher.handle(message)).resolves.toEqual({
      outcome: 'processed',
    });
    expect(process).toHaveBeenCalledWith(message.body, routingKey);
  });

  it('rejects strict contract violations without opening a transaction', async () => {
    const { dispatcher, process } = harness();
    const message = incoming(
      ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
      'ErrandAccepted',
      {
        errandId: ids.errandId,
        requesterUserId: ids.requesterUserId,
        courierUserId: ids.courierUserId,
        extra: true,
      },
    );

    await expect(dispatcher.handle(message)).resolves.toMatchObject({
      outcome: 'permanent-failure',
      category: 'INVALID_PAYLOAD',
      eventId: ids.eventId,
    });
    expect(process).not.toHaveBeenCalled();
  });

  it('rejects a requester who is also the courier as invalid payload', async () => {
    const { dispatcher, process } = harness();
    const message = incoming(
      ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
      'ErrandAccepted',
      {
        errandId: ids.errandId,
        requesterUserId: ids.requesterUserId,
        courierUserId: ids.requesterUserId,
      },
    );
    await expect(dispatcher.handle(message)).resolves.toEqual({
      outcome: 'permanent-failure',
      eventId: ids.eventId,
      category: 'INVALID_PAYLOAD',
      reason: 'requester and courier must be different users',
    });
    expect(process).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate', { outcome: 'duplicate' }],
    [
      'event-id-conflict',
      {
        outcome: 'permanent-failure',
        eventId: ids.eventId,
        category: 'IDENTITY_CONFLICT',
        reason: 'event ID was previously recorded with different evidence',
      },
    ],
  ] as const)('maps the %s ingestion outcome', async (status, expected) => {
    const { dispatcher, process } = harness();
    process.mockResolvedValue({ status, eventId: ids.eventId });
    const message = incoming(
      ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
      'ErrandAccepted',
      {
        errandId: ids.errandId,
        requesterUserId: ids.requesterUserId,
        courierUserId: ids.courierUserId,
      },
    );
    await expect(dispatcher.handle(message)).resolves.toEqual(expected);
  });

  it('rejects an unsupported logical route', async () => {
    const { dispatcher, process } = harness();
    await expect(
      dispatcher.handle(incoming('order.unknown.v1', 'Unknown', {})),
    ).resolves.toMatchObject({
      outcome: 'permanent-failure',
      category: 'UNSUPPORTED_EVENT_TYPE',
    });
    expect(process).not.toHaveBeenCalled();
  });
});
