import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type CreditReservationEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { CreditReservationMessageHandler } from './credit-reservation-message.handler.js';
import type { ReservationService } from './reservation.service.js';

const event = (): CreditReservationEvent => ({
  eventId: randomUUID(),
  eventType: 'CreditReservation',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: {
    errandId: randomUUID(),
    requesterUserId: randomUUID(),
    amount: 50,
  },
});

const message = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'credit.reservation.v1',
  eventId:
    typeof body === 'object' && body !== null && 'eventId' in body
      ? String(body.eventId)
      : undefined,
  retryCount: 0,
});

describe('CreditReservationMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before durable ingress', async () => {
    const accept = vi.fn();
    const handler = new CreditReservationMessageHandler(contracts, {
      accept,
    } as unknown as ReservationService);
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
    const handler = new CreditReservationMessageHandler(contracts, {
      accept,
    } as unknown as ReservationService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
    expect(accept).toHaveBeenCalledWith(incoming);
  });

  it('dead-letters conflicting reuse of an event ID', async () => {
    const incoming = event();
    const handler = new CreditReservationMessageHandler(contracts, {
      accept: vi.fn().mockResolvedValue({
        status: 'event-id-conflict',
        eventId: incoming.eventId,
      }),
    } as unknown as ReservationService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category: 'INVALID_ENVELOPE',
      reason: 'event ID was previously processed with different content',
    });
  });

  it('propagates ingress failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new CreditReservationMessageHandler(contracts, {
      accept: vi.fn().mockRejectedValue(failure),
    } as unknown as ReservationService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
