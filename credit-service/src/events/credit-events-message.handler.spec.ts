import type { UserRegisteredMessageHandler } from '../account-initialization/user-registered-message.handler.js';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import type { ErrandCancelledMessageHandler } from '../settlement/errand-cancelled-message.handler.js';
import type { ErrandCompletedMessageHandler } from '../settlement/errand-completed-message.handler.js';
import { CreditEventsMessageHandler } from './credit-events-message.handler.js';

function incoming(routingKey: string): IncomingDomainMessage {
  return {
    body: {},
    rawBody: Buffer.from('{}'),
    routingKey,
    eventId: '19860606-e57b-4e8d-baa9-7f5b11293f41',
    retryCount: 0,
  };
}

function createHandler() {
  const delegate = () => ({
    handle: vi.fn().mockResolvedValue({ outcome: 'ack' }),
  });
  const userRegistered = delegate();
  const errandCompleted = delegate();
  const errandCancelled = delegate();
  return {
    userRegistered,
    errandCompleted,
    errandCancelled,
    handler: new CreditEventsMessageHandler(
      userRegistered as unknown as UserRegisteredMessageHandler,
      errandCompleted as unknown as ErrandCompletedMessageHandler,
      errandCancelled as unknown as ErrandCancelledMessageHandler,
    ),
  };
}

describe('CreditEventsMessageHandler', () => {
  it.each([
    ['user.registered.v1', 'userRegistered'],
    ['order.errand-completed.v1', 'errandCompleted'],
    ['order.errand-cancelled.v1', 'errandCancelled'],
  ] as const)('routes %s to its use case only', async (routingKey, target) => {
    const handlers = createHandler();
    const message = incoming(routingKey);

    await expect(handlers.handler.handle(message)).resolves.toEqual({
      outcome: 'ack',
    });

    for (const name of [
      'userRegistered',
      'errandCompleted',
      'errandCancelled',
    ] as const) {
      expect(handlers[name].handle).toHaveBeenCalledTimes(
        name === target ? 1 : 0,
      );
    }
    expect(handlers[target].handle).toHaveBeenCalledWith(message);
  });

  it('dead-letters a key that has no use case', async () => {
    const { handler } = createHandler();

    await expect(
      handler.handle(incoming('order.errand-accepted.v1')),
    ).resolves.toMatchObject({
      outcome: 'dead-letter',
      category: 'UNSUPPORTED_EVENT_TYPE',
    });
  });

  it('propagates transient failures so the transport retries', async () => {
    const { handler, errandCompleted } = createHandler();
    errandCompleted.handle.mockRejectedValue(new Error('db down'));

    await expect(
      handler.handle(incoming('order.errand-completed.v1')),
    ).rejects.toThrow('db down');
  });
});
