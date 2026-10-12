import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type CreditReservationAdjustmentEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import type { ReservationAdjustmentService } from './reservation-adjustment.service.js';
import { CreditReservationAdjustmentMessageHandler } from './credit-reservation-adjustment-message.handler.js';

const event = (): CreditReservationAdjustmentEvent => ({
  eventId: randomUUID(),
  eventType: 'CreditReservationAdjustment',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: { errandId: randomUUID(), oldAmount: 50, newAmount: 75 },
});

const message = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'credit.reservation-adjustment.v1',
  eventId:
    typeof body === 'object' && body !== null && 'eventId' in body
      ? String(body.eventId)
      : undefined,
  retryCount: 0,
});

describe('CreditReservationAdjustmentMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before adjustment execution', async () => {
    const accept = vi.fn();
    const handler = new CreditReservationAdjustmentMessageHandler(contracts, {
      accept,
    } as unknown as ReservationAdjustmentService);
    const invalid = { ...event(), payload: { token: 'secret' } };

    const result = await handler.handle(message(invalid));

    expect(result).toMatchObject({
      outcome: 'dead-letter',
      category: 'INVALID_PAYLOAD',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(accept).not.toHaveBeenCalled();
  });

  it('acknowledges new and duplicate durable ingress after commit', async () => {
    const incoming = event();
    const accept = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        eventId: incoming.eventId,
        operationId: randomUUID(),
      })
      .mockResolvedValueOnce({
        status: 'duplicate-event',
        eventId: incoming.eventId,
        operationId: randomUUID(),
        transactionId: null,
        outboxEventId: null,
      });
    const handler = new CreditReservationAdjustmentMessageHandler(contracts, {
      accept,
    } as unknown as ReservationAdjustmentService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
  });

  it('dead-letters conflicting reuse of an event ID', async () => {
    const incoming = event();
    const handler = new CreditReservationAdjustmentMessageHandler(contracts, {
      accept: vi.fn().mockResolvedValue({
        status: 'event-id-conflict',
        eventId: incoming.eventId,
      }),
    } as unknown as ReservationAdjustmentService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('propagates execution failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new CreditReservationAdjustmentMessageHandler(contracts, {
      accept: vi.fn().mockRejectedValue(failure),
    } as unknown as ReservationAdjustmentService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
