import { randomUUID } from 'node:crypto';
import { AccountEventContractValidator } from '@foc/contracts';
import { SYSTEM } from '../lifecycle/transition.js';
import type { IncomingDomainMessage } from '../messaging/rabbitmq-message.types.js';
import { CreditReplyHandler, REPLY_SPECS } from './credit-reply.handler.js';

const contracts = new AccountEventContractValidator();
const errandId = randomUUID();
const requesterUserId = randomUUID();
const courierUserId = randomUUID();
const txId = randomUUID();

const payloads: Record<string, object> = {
  'credit.reservation-success.v1': { errandId, requesterUserId, reservedAmount: 5, creditTransactionId: txId },
  'credit.reservation-rejected.v1': { errandId, requesterUserId, requestedAmount: 5, rejectionReason: 'INSUFFICIENT_CREDITS' },
  'credit.reservation-adjustment-success.v1': { errandId, newReservedAmount: 8, creditTransactionId: txId },
  'credit.reservation-adjustment-rejected.v1': { errandId, requestedAmount: 8, rejectionReason: 'INSUFFICIENT_CREDITS' },
  'credit.transfer-succeeded.v1': { errandId, requesterUserId, courierUserId, transferredAmount: 5, creditTransactionId: txId },
  'credit.transfer-rejected.v1': { errandId, requesterUserId, courierUserId, rejectionReason: 'DESTINATION_ARCHIVED' },
  'credit.release-rejected.v1': { errandId, requesterUserId, rejectionReason: 'ALREADY_TRANSFERRED' },
};

const eventTypes: Record<string, string> = {
  'credit.reservation-success.v1': 'CreditReservationSuccess',
  'credit.reservation-rejected.v1': 'CreditReservationRejected',
  'credit.reservation-adjustment-success.v1': 'CreditReservationAdjustmentSuccess',
  'credit.reservation-adjustment-rejected.v1': 'CreditReservationAdjustmentRejected',
  'credit.transfer-succeeded.v1': 'CreditTransferSucceeded',
  'credit.transfer-rejected.v1': 'CreditTransferRejected',
  'credit.release-rejected.v1': 'CreditReleaseRejected',
};

const envelope = (key: string, payload: object = payloads[key]) => ({
  eventId: randomUUID(),
  eventType: eventTypes[key],
  timestamp: new Date().toISOString(),
  publisher: 'credit-service',
  payload,
});
const message = (body: { eventId: string }): IncomingDomainMessage => ({
  body,
  rawBody: Buffer.from(JSON.stringify(body)),
  routingKey: 'x',
  eventId: body.eventId,
  retryCount: 0,
});

const spec = (key: string) => REPLY_SPECS.find((s) => s.key === key)!;
function setup(key: string, result: unknown = { ok: true, sequenceNumber: 2 }) {
  const lifecycle = {
    transition: vi.fn().mockResolvedValue(result),
    releaseCredit: vi.fn().mockResolvedValue(undefined),
    supplierIdOf: vi.fn(),
  };
  return { lifecycle, handler: new CreditReplyHandler(spec(key), lifecycle, contracts) };
}

describe('CreditReplyHandler', () => {
  it('has the seven subscriptions on the seeded queues', () => {
    expect(REPLY_SPECS.map((s) => s.queue).sort()).toEqual([
      'order-service.credit-release-rejected.v1',
      'order-service.credit-reservation-adjustment-rejected.v1',
      'order-service.credit-reservation-adjustment-success.v1',
      'order-service.credit-reservation-rejected.v1',
      'order-service.credit-reservation-success.v1',
      'order-service.credit-transfer-rejected.v1',
      'order-service.credit-transfer-succeeded.v1',
    ]);
  });

  it.each([
    ['credit.reservation-success.v1', 'Reserving-Credit', 'Open'],
    ['credit.reservation-rejected.v1', 'Reserving-Credit', 'Cancelled'],
    ['credit.reservation-adjustment-success.v1', 'Adjusting-Credit', 'Open'],
    ['credit.reservation-adjustment-rejected.v1', 'Adjusting-Credit', 'Open'],
    ['credit.transfer-succeeded.v1', 'Transferring-Credit', 'Completed'],
    ['credit.transfer-rejected.v1', 'Transferring-Credit', 'Incomplete'],
  ])('%s -> one SYSTEM transition keyed by the eventId', async (key, expected, to) => {
    const { handler, lifecycle } = setup(key);
    const body = envelope(key);

    expect(await handler.handle(message(body))).toEqual({ outcome: 'ack' });
    expect(lifecycle.transition).toHaveBeenCalledWith(
      expect.objectContaining({ errandId, expected, to, actor: SYSTEM, idempotencyKey: body.eventId }),
    );
  });

  it('carries the new amount and the cancellation reason as edge columns', async () => {
    const adjust = setup('credit.reservation-adjustment-success.v1');
    await adjust.handler.handle(message(envelope('credit.reservation-adjustment-success.v1')));
    expect(adjust.lifecycle.transition).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CreditAdjusted', set: { rewardCredits: 8 } }),
    );

    const rejected = setup('credit.reservation-rejected.v1');
    await rejected.handler.handle(message(envelope('credit.reservation-rejected.v1')));
    expect(rejected.lifecycle.transition).toHaveBeenCalledWith(
      expect.objectContaining({ set: { cancellationReason: 'INSUFFICIENT_CREDITS' } }),
    );
  });

  it('dead-letters an invalid payload without touching the lifecycle', async () => {
    const { handler, lifecycle } = setup('credit.transfer-succeeded.v1');
    const result = await handler.handle(
      message(envelope('credit.transfer-succeeded.v1', { errandId })),
    );
    expect(result).toMatchObject({ outcome: 'dead-letter', category: 'INVALID_PAYLOAD' });
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('dead-letters RESERVATION_CONFLICT, which is not a cancellation reason', async () => {
    const { handler, lifecycle } = setup('credit.reservation-rejected.v1');
    const body = envelope('credit.reservation-rejected.v1', {
      ...payloads['credit.reservation-rejected.v1'],
      rejectionReason: 'RESERVATION_CONFLICT',
    });
    expect(await handler.handle(message(body))).toMatchObject({ outcome: 'dead-letter' });
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('only logs a release rejection (nothing to revert)', async () => {
    const { handler, lifecycle } = setup('credit.release-rejected.v1');
    expect(await handler.handle(message(envelope('credit.release-rejected.v1')))).toEqual({
      outcome: 'ack',
    });
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('releases again on a late reservation success for a Cancelled errand', async () => {
    const { handler, lifecycle } = setup('credit.reservation-success.v1', {
      ok: false,
      reason: 'STATE_MISMATCH',
      currentStatus: 'Cancelled',
    });
    const body = envelope('credit.reservation-success.v1');
    expect(await handler.handle(message(body))).toEqual({ outcome: 'ack' });
    expect(lifecycle.releaseCredit).toHaveBeenCalledWith(errandId, body.eventId);
  });

  it('acks other stale replies without a release', async () => {
    const stale = { ok: false, reason: 'STATE_MISMATCH', currentStatus: 'Cancelled' };
    const success = setup('credit.reservation-success.v1', { ...stale, currentStatus: 'Open' });
    expect(await success.handler.handle(message(envelope('credit.reservation-success.v1')))).toEqual({
      outcome: 'ack',
    });
    const transfer = setup('credit.transfer-succeeded.v1', stale);
    await transfer.handler.handle(message(envelope('credit.transfer-succeeded.v1')));
    const missing = setup('credit.transfer-succeeded.v1', { ok: false, reason: 'NOT_FOUND' });
    expect(await missing.handler.handle(message(envelope('credit.transfer-succeeded.v1')))).toEqual({
      outcome: 'ack',
    });
    expect(success.lifecycle.releaseCredit).not.toHaveBeenCalled();
    expect(transfer.lifecycle.releaseCredit).not.toHaveBeenCalled();
  });

  it('dead-letters a reused event id and throws on a refusal that is our bug', async () => {
    const reused = setup('credit.transfer-succeeded.v1', { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await reused.handler.handle(message(envelope('credit.transfer-succeeded.v1')))).toMatchObject({
      outcome: 'dead-letter',
    });
    const bug = setup('credit.transfer-succeeded.v1', { ok: false, reason: 'ILLEGAL_TRANSITION' });
    await expect(bug.handler.handle(message(envelope('credit.transfer-succeeded.v1')))).rejects.toThrow(
      /ILLEGAL_TRANSITION/,
    );
  });

  it('lets a database error propagate for the broker to retry', async () => {
    const { handler, lifecycle } = setup('credit.transfer-succeeded.v1');
    lifecycle.transition.mockRejectedValue(new Error('connection lost'));
    await expect(handler.handle(message(envelope('credit.transfer-succeeded.v1')))).rejects.toThrow(
      'connection lost',
    );
  });
});
