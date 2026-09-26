import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type UserRegisteredEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import type { AccountInitializationService } from './account-initialization.service.js';
import { UserRegisteredMessageHandler } from './user-registered-message.handler.js';

function event(): UserRegisteredEvent {
  return {
    eventId: randomUUID(),
    eventType: 'UserRegistered',
    timestamp: new Date().toISOString(),
    publisher: 'user-service',
    payload: {
      userId: randomUUID(),
      email: 'alex@example.edu',
      displayName: 'Alex',
    },
  };
}

function message(body: unknown): IncomingDomainMessage {
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    routingKey: 'user.registered.v1',
    eventId:
      typeof body === 'object' && body !== null && 'eventId' in body
        ? String(body.eventId)
        : undefined,
    retryCount: 0,
  };
}

describe('UserRegisteredMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before invoking the processor', async () => {
    const process = vi.fn();
    const handler = new UserRegisteredMessageHandler(contracts, {
      process,
    } as unknown as AccountInitializationService);
    const invalid = { ...event(), payload: { privateValue: 'secret' } };

    const result = await handler.handle(message(invalid));

    expect(result).toMatchObject({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(process).not.toHaveBeenCalled();
  });

  it('acknowledges only after processing has completed', async () => {
    const incoming = event();
    const process = vi.fn().mockResolvedValue({
      status: 'created',
      userId: incoming.payload.userId,
      allocationId: randomUUID(),
      outboxEventId: randomUUID(),
    });
    const handler = new UserRegisteredMessageHandler(contracts, {
      process,
    } as unknown as AccountInitializationService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
    expect(process).toHaveBeenCalledWith(incoming);
  });

  it('dead-letters an event ID conflict as an invalid envelope', async () => {
    const incoming = event();
    const handler = new UserRegisteredMessageHandler(contracts, {
      process: vi.fn().mockResolvedValue({
        status: 'event-id-conflict',
        eventId: incoming.eventId,
      }),
    } as unknown as AccountInitializationService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('propagates operational failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new UserRegisteredMessageHandler(contracts, {
      process: vi.fn().mockRejectedValue(failure),
    } as unknown as AccountInitializationService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
