import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { SupplierValidationMessageHandler } from './supplier-validation-message.handler.js';
import type {
  SupplierValidationResult,
  SupplierValidationService,
} from './supplier-validation.service.js';

const request = (overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  eventType: 'SupplierValidationRequested',
  timestamp: '2026-10-20T10:00:00.000Z',
  publisher: 'order-service',
  payload: { errandId: randomUUID(), supplierId: randomUUID() },
  ...overrides,
});

const delivery = (body: unknown): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'order.supplier-validation-requested.v1',
  eventId: (body as { eventId?: string }).eventId,
  retryCount: 0,
});

describe('SupplierValidationMessageHandler', () => {
  const contracts = new AccountEventContractValidator();
  const process =
    vi.fn<(event: unknown) => Promise<SupplierValidationResult>>();
  const handler = new SupplierValidationMessageHandler(contracts, {
    process,
  } as unknown as SupplierValidationService);

  beforeEach(() => {
    process.mockReset();
  });

  it('processes a valid request, then acknowledges it (F15.7.8)', async () => {
    const body = request();
    process.mockResolvedValue({
      status: 'answered',
      replyEventId: randomUUID(),
      outcome: 'FOUND',
    });

    await expect(handler.handle(delivery(body))).resolves.toEqual({
      outcome: 'ack',
    });
    expect(process).toHaveBeenCalledWith(body);
  });

  it('acknowledges a redelivered request without answering again (F15.7.4)', async () => {
    process.mockResolvedValue({
      status: 'duplicate-event',
      replyEventId: randomUUID(),
    });

    await expect(handler.handle(delivery(request()))).resolves.toEqual({
      outcome: 'ack',
    });
  });

  it.each([
    [
      'a missing supplier id',
      request({ payload: { errandId: randomUUID() } }),
      'INVALID_PAYLOAD',
    ],
    [
      'an unknown field',
      request({
        payload: {
          errandId: randomUUID(),
          supplierId: randomUUID(),
          extra: 1,
        },
      }),
      'INVALID_PAYLOAD',
    ],
    [
      'another publisher (F13.7)',
      request({ publisher: 'credit-service' }),
      'INVALID_ENVELOPE',
    ],
    ['a non-object body', 'not json', 'INVALID_ENVELOPE'],
  ])(
    'dead-letters a request with %s, without processing it (F15.7.6)',
    async (_, body, category) => {
      await expect(handler.handle(delivery(body))).resolves.toMatchObject({
        outcome: 'dead-letter',
        category,
      });
      expect(process).not.toHaveBeenCalled();
    },
  );

  it('dead-letters an event id reused for different content', async () => {
    const body = request();
    process.mockResolvedValue({
      status: 'event-id-conflict',
      eventId: body.eventId,
    });

    await expect(handler.handle(delivery(body))).resolves.toMatchObject({
      outcome: 'dead-letter',
      eventId: body.eventId,
      category: 'INVALID_ENVELOPE',
    });
  });

  it('lets a transient failure throw, so the transport retries it (F15.7.5)', async () => {
    process.mockRejectedValue(new Error('connection refused'));

    await expect(handler.handle(delivery(request()))).rejects.toThrow(
      'connection refused',
    );
  });
});
