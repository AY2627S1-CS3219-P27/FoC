import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type ErrandCompletedEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { ErrandCompletedMessageHandler } from './errand-completed-message.handler.js';
import type { TransferService } from './transfer.service.js';

const event = (): ErrandCompletedEvent => ({
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

const message = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'order.errand-completed.v1',
  eventId:
    typeof body === 'object' && body !== null && 'eventId' in body
      ? String(body.eventId)
      : undefined,
  retryCount: 0,
});

describe('ErrandCompletedMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before durable ingress', async () => {
    const accept = vi.fn();
    const handler = new ErrandCompletedMessageHandler(contracts, {
      accept,
    } as unknown as TransferService);
    const invalid = { ...event(), payload: { privateValue: 'secret' } };

    const result = await handler.handle(message(invalid));

    expect(result).toMatchObject({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(accept).not.toHaveBeenCalled();
  });

  it('acknowledges only after durable ingress completes', async () => {
    const incoming = event();
    const accept = vi.fn().mockResolvedValue({
      status: 'accepted',
      eventId: incoming.eventId,
      operationId: randomUUID(),
    });
    const handler = new ErrandCompletedMessageHandler(contracts, {
      accept,
    } as unknown as TransferService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
    expect(accept).toHaveBeenCalledWith(incoming);
  });

  it('dead-letters conflicting reuse of an event ID', async () => {
    const incoming = event();
    const handler = new ErrandCompletedMessageHandler(contracts, {
      accept: vi.fn().mockResolvedValue({
        status: 'event-id-conflict',
        eventId: incoming.eventId,
      }),
    } as unknown as TransferService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('propagates ingress failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new ErrandCompletedMessageHandler(contracts, {
      accept: vi.fn().mockRejectedValue(failure),
    } as unknown as TransferService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
