import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type ErrandCancelledEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { ErrandCancelledMessageHandler } from './errand-cancelled-message.handler.js';
import type { ReleaseService } from './release.service.js';

const event = (): ErrandCancelledEvent => ({
  eventId: randomUUID(),
  eventType: 'ErrandCancelled',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: { errandId: randomUUID() },
});

const message = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'order.errand-cancelled.v1',
  eventId:
    typeof body === 'object' && body !== null && 'eventId' in body
      ? String(body.eventId)
      : undefined,
  retryCount: 0,
});

describe('ErrandCancelledMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before durable ingress', async () => {
    const accept = vi.fn();
    const handler = new ErrandCancelledMessageHandler(contracts, {
      accept,
    } as unknown as ReleaseService);
    const invalid = {
      ...event(),
      payload: { errandId: randomUUID(), privateValue: 'secret' },
    };

    const result = await handler.handle(message(invalid));

    expect(result).toMatchObject({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(accept).not.toHaveBeenCalled();
  });

  it.each([
    'accepted',
    'duplicate-event',
    'semantic-replay-pending',
    'semantic-replay-completed',
  ] as const)(
    'acknowledges %s only after ingress completes',
    async (status) => {
      const incoming = event();
      const accept = vi.fn().mockResolvedValue({
        status,
        eventId: incoming.eventId,
        operationId: randomUUID(),
      });
      const handler = new ErrandCancelledMessageHandler(contracts, {
        accept,
      } as unknown as ReleaseService);

      await expect(handler.handle(message(incoming))).resolves.toEqual({
        outcome: 'ack',
      });
      expect(accept).toHaveBeenCalledWith(incoming);
    },
  );

  it('dead-letters conflicting reuse of an event ID', async () => {
    const incoming = event();
    const handler = new ErrandCancelledMessageHandler(contracts, {
      accept: vi.fn().mockResolvedValue({
        status: 'event-id-conflict',
        eventId: incoming.eventId,
      }),
    } as unknown as ReleaseService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('propagates ingress failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new ErrandCancelledMessageHandler(contracts, {
      accept: vi.fn().mockRejectedValue(failure),
    } as unknown as ReleaseService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
