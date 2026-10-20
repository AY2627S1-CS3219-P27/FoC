import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { supplierSnapshot } from '../../test/payloads.js';
import { CreditReplyHandler } from '../credit-replies/credit-reply.handler.js';
import { SYSTEM } from '../lifecycle/transition.js';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { SUPPLIER_REPLY_SPECS } from './supplier-replies.js';

const contracts = new AccountEventContractValidator();
const errandId = randomUUID();
const supplierId = randomUUID();
const timestamp = '2030-01-01T00:00:00.000Z';

const envelope = (payload: object, publisher = 'supplier-service') => ({
  eventId: randomUUID(),
  eventType: 'SupplierValidationCompleted',
  timestamp,
  publisher,
  payload,
});
const found = (status: 'Active' | 'Inactive') =>
  envelope({ errandId, supplierId, outcome: 'FOUND', supplier: { ...supplierSnapshot, status } });
const message = (body: { eventId: string }): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'supplier.validation-completed.v1',
  eventId: body.eventId,
  retryCount: 0,
});

function setup(result: unknown = { ok: true, sequenceNumber: 2 }, errandSupplier: string | undefined = supplierId) {
  const lifecycle = {
    transition: vi.fn().mockResolvedValue(result),
    releaseCredit: vi.fn().mockResolvedValue(undefined),
    supplierIdOf: vi.fn().mockResolvedValue(errandSupplier),
  };
  return { lifecycle, handler: new CreditReplyHandler(SUPPLIER_REPLY_SPECS[0], lifecycle, contracts) };
}

describe('supplier validation reply', () => {
  it('subscribes the queue seeded for it', () => {
    expect(SUPPLIER_REPLY_SPECS.map((s) => s.queue)).toEqual([
      'order-service.supplier-validation-completed.v1',
    ]);
  });

  it('moves an Active supplier on, stamped with the reply time and keeping the snapshot', async () => {
    const { lifecycle, handler } = setup();
    const body = found('Active');
    expect(await handler.handle(message(body))).toEqual({ outcome: 'ack' });
    expect(lifecycle.transition).toHaveBeenCalledWith({
      errandId,
      expected: 'Pending-Supplier',
      to: 'Reserving-Credit',
      set: { supplierValidatedAt: new Date(timestamp) },
      payload: { supplierEventId: body.eventId, supplier: { ...supplierSnapshot, status: 'Active' } },
      actor: SYSTEM,
      idempotencyKey: body.eventId,
    });
  });

  it.each([
    ['an Inactive supplier', found('Inactive'), 'INACTIVE'],
    ['a missing supplier', envelope({ errandId, supplierId, outcome: 'NOT_FOUND' }), 'NOT_FOUND'],
  ])('cancels for %s with SUPPLIER_UNAVAILABLE', async (_, body, supplierOutcome) => {
    const { lifecycle, handler } = setup();
    expect(await handler.handle(message(body))).toEqual({ outcome: 'ack' });
    expect(lifecycle.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: 'Pending-Supplier',
        to: 'Cancelled',
        set: { cancellationReason: 'SUPPLIER_UNAVAILABLE' },
        payload: { supplierEventId: body.eventId, supplierOutcome },
      }),
    );
  });

  it('acks a late reply for an errand already cancelled, releasing nothing', async () => {
    const { lifecycle, handler } = setup({ ok: false, reason: 'STATE_MISMATCH', currentStatus: 'Cancelled' });
    expect(await handler.handle(message(found('Active')))).toEqual({ outcome: 'ack' });
    expect(lifecycle.releaseCredit).not.toHaveBeenCalled();
  });

  it('dead-letters a reply naming a supplier the errand does not reference', async () => {
    const { lifecycle, handler } = setup(undefined, randomUUID());
    const res = await handler.handle(message(found('Active')));
    expect(res).toMatchObject({ outcome: 'dead-letter', category: 'INVALID_PAYLOAD' });
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('leaves an unknown errand to the transition, which acks it as NOT_FOUND', async () => {
    const { lifecycle, handler } = setup({ ok: false, reason: 'NOT_FOUND' }, undefined);
    expect(await handler.handle(message(found('Active')))).toEqual({ outcome: 'ack' });
    expect(lifecycle.transition).toHaveBeenCalledOnce();
  });

  it('dead-letters a reply that is not from Supplier Service', async () => {
    const { lifecycle, handler } = setup();
    const res = await handler.handle(message(envelope({ errandId, supplierId, outcome: 'NOT_FOUND' }, 'credit-service')));
    expect(res).toMatchObject({ outcome: 'dead-letter' });
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });
});
