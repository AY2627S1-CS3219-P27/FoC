import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type CreditSettlementEvent,
} from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { CreditSettlementMessageHandler } from './credit-settlement-message.handler.js';
import type { SettlementService } from './settlement.service.js';

const event = (): CreditSettlementEvent => ({
  eventId: randomUUID(),
  eventType: 'CreditSettlementRequested',
  timestamp: new Date().toISOString(),
  publisher: 'order-service',
  payload: {
    errandId: randomUUID(),
    requesterUserId: randomUUID(),
    courierUserId: randomUUID(),
    courierAmount: 30,
    requesterAmount: 20,
    attempt: 1,
  },
});

const message = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'credit.settlement.v1',
  eventId:
    typeof body === 'object' && body !== null && 'eventId' in body
      ? String(body.eventId)
      : undefined,
  retryCount: 0,
});

describe('CreditSettlementMessageHandler', () => {
  const contracts = new AccountEventContractValidator();

  it('dead-letters invalid contracts before durable ingress', async () => {
    const accept = vi.fn();
    const handler = new CreditSettlementMessageHandler(contracts, {
      accept,
    } as unknown as SettlementService);
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
    const handler = new CreditSettlementMessageHandler(contracts, {
      accept,
    } as unknown as SettlementService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'ack',
    });
    expect(accept).toHaveBeenCalledWith(incoming);
  });

  it.each([
    ['event-id-conflict', 'INVALID_ENVELOPE'],
    ['attempt-conflict', 'INVALID_PAYLOAD'],
    ['invalid-command', 'INVALID_PAYLOAD'],
  ] as const)('dead-letters %s', async (status, category) => {
    const incoming = event();
    const handler = new CreditSettlementMessageHandler(contracts, {
      accept: vi.fn().mockResolvedValue({
        status,
        eventId: incoming.eventId,
        reason: 'conflict',
      }),
    } as unknown as SettlementService);

    await expect(handler.handle(message(incoming))).resolves.toEqual({
      outcome: 'dead-letter',
      eventId: incoming.eventId,
      category,
      reason: 'conflict',
    });
  });

  it('propagates ingress failures for transport retry', async () => {
    const failure = new Error('database unavailable');
    const handler = new CreditSettlementMessageHandler(contracts, {
      accept: vi.fn().mockRejectedValue(failure),
    } as unknown as SettlementService);

    await expect(handler.handle(message(event()))).rejects.toBe(failure);
  });
});
