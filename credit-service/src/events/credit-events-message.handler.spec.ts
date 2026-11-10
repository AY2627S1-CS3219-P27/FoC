import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type ErrandCancelledEvent,
  type ErrandCompletedEvent,
  type UserRegisteredEvent,
} from '@foc/contracts';
import type { AccountInitializationService } from '../account-initialization/account-initialization.service.js';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import type { ReleaseService } from '../settlement/release.service.js';
import type { TransferService } from '../settlement/transfer.service.js';
import { CreditEventsMessageHandler } from './credit-events-message.handler.js';

const registered = (): UserRegisteredEvent => ({
  eventId: randomUUID(),
  eventType: 'UserRegistered',
  timestamp: new Date().toISOString(),
  publisher: 'user-service',
  payload: {
    userId: randomUUID(),
    email: 'alex@example.edu',
    displayName: 'Alex',
  },
});

const completed = (): ErrandCompletedEvent => ({
  eventId: randomUUID(),
  eventType: 'ErrandCompleted',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: {
    errandId: randomUUID(),
    requesterUserId: randomUUID(),
    courierUserId: randomUUID(),
    amount: 25,
  },
});

const cancelled = (): ErrandCancelledEvent => ({
  eventId: randomUUID(),
  eventType: 'ErrandCancelled',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: { errandId: randomUUID() },
});

function incoming(routingKey: string, body: unknown): IncomingDomainMessage {
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    routingKey,
    eventId:
      typeof body === 'object' && body !== null && 'eventId' in body
        ? String(body.eventId)
        : undefined,
    retryCount: 0,
  };
}

function createHandler() {
  const process = vi.fn().mockResolvedValue({ status: 'created' });
  const accept = vi.fn().mockResolvedValue({ status: 'accepted' });
  const release = vi.fn().mockResolvedValue({ status: 'accepted' });
  return {
    process,
    accept,
    release,
    handler: new CreditEventsMessageHandler(
      new AccountEventContractValidator(),
      { process } as unknown as AccountInitializationService,
      { accept } as unknown as TransferService,
      { accept: release } as unknown as ReleaseService,
    ),
  };
}

describe('CreditEventsMessageHandler', () => {
  it.each([
    ['user.registered.v1', registered, 'process'],
    ['order.errand-completed.v1', completed, 'accept'],
    ['order.errand-cancelled.v1', cancelled, 'release'],
  ] as const)(
    'routes %s to its use case only and acknowledges',
    async (routingKey, build, target) => {
      const mocks = createHandler();
      const event = build();

      await expect(
        mocks.handler.handle(incoming(routingKey, event)),
      ).resolves.toEqual({ outcome: 'ack' });

      for (const name of ['process', 'accept', 'release'] as const) {
        expect(mocks[name]).toHaveBeenCalledTimes(name === target ? 1 : 0);
      }
      expect(mocks[target]).toHaveBeenCalledWith(event);
    },
  );

  it.each([
    ['user.registered.v1', registered],
    ['order.errand-completed.v1', completed],
    ['order.errand-cancelled.v1', cancelled],
  ] as const)(
    'dead-letters an invalid %s contract without invoking a use case',
    async (routingKey, build) => {
      const mocks = createHandler();
      const invalid = { ...build(), payload: { privateValue: 'secret' } };

      const result = await mocks.handler.handle(incoming(routingKey, invalid));

      expect(result).toMatchObject({
        outcome: 'dead-letter',
        category: 'INVALID_PAYLOAD',
      });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(mocks.process).not.toHaveBeenCalled();
      expect(mocks.accept).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    },
  );

  it('dead-letters conflicting reuse of an event ID', async () => {
    const mocks = createHandler();
    const event = completed();
    mocks.accept.mockResolvedValue({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });

    await expect(
      mocks.handler.handle(incoming('order.errand-completed.v1', event)),
    ).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: event.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('dead-letters a key that has no use case', async () => {
    const { handler } = createHandler();

    await expect(
      handler.handle(incoming('order.errand-accepted.v1', {})),
    ).resolves.toMatchObject({
      outcome: 'dead-letter',
      category: 'UNSUPPORTED_EVENT_TYPE',
    });
  });

  it('propagates operational failures for transport retry', async () => {
    const mocks = createHandler();
    const failure = new Error('database unavailable');
    mocks.process.mockRejectedValue(failure);

    await expect(
      mocks.handler.handle(incoming('user.registered.v1', registered())),
    ).rejects.toBe(failure);
  });
});
