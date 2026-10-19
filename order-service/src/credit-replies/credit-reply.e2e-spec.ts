import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  eventRegistry,
  type EventContractKey,
} from '@foc/contracts';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db.js';
import { errandEvents, errands, outboxEvents } from '../db/schema.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { rebuildProjection } from '../lifecycle/rebuild.js';
import type { Status } from '../lifecycle/status.js';
import { SYSTEM, transition } from '../lifecycle/transition.js';
import { CreditReplyHandler, REPLY_SPECS } from './credit-reply.handler.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
let lifecycle: LifecycleService;
beforeAll(async () => {
  t = await createTestDb();
  lifecycle = new LifecycleService(t.db);
});
afterAll(() => t.close());

const requester = randomUUID();
const courier = randomUUID();
const contracts = new AccountEventContractValidator();

async function seed(status: Status) {
  const id = randomUUID();
  await t.db.insert(errands).values({
    id,
    requesterId: requester,
    status,
    supplierId: randomUUID(),
    courierId: status === 'Transferring-Credit' ? courier : undefined,
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    collectionItems: 'bubble tea',
  });
  return id;
}

// Feeds a credit reply to the handler as the broker would.
function deliver(key: string, payload: object, eventId = randomUUID()) {
  const spec = REPLY_SPECS.find((s) => s.key === key)!;
  const body = {
    eventId,
    eventType: eventRegistry[key as EventContractKey].eventType,
    timestamp: new Date().toISOString(),
    publisher: 'credit-service',
    payload,
  };
  return new CreditReplyHandler(spec, lifecycle, contracts).handle({
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    routingKey: key,
    eventId,
    retryCount: 0,
  });
}

const row = async (id: string) =>
  (await t.db.select().from(errands).where(eq(errands.id, id)))[0];
const events = (id: string) =>
  t.db.select().from(errandEvents).where(eq(errandEvents.errandId, id));
const releases = async (id: string) =>
  (await t.db.select().from(outboxEvents)).filter(
    (r) =>
      r.routingKey === 'order.errand-cancelled.v1' &&
      (r.envelope.payload as { errandId?: string }).errandId === id,
  );

describe('credit replies against the database', () => {
  it('reservation success opens the errand, and a redelivery changes nothing', async () => {
    const id = await seed('Reserving-Credit');
    const eventId = randomUUID();
    const payload = { errandId: id, requesterUserId: requester, reservedAmount: 5, creditTransactionId: randomUUID() };

    expect(await deliver('credit.reservation-success.v1', payload, eventId)).toEqual({ outcome: 'ack' });
    expect(await deliver('credit.reservation-success.v1', payload, eventId)).toEqual({ outcome: 'ack' });

    expect((await row(id)).status).toBe('Open');
    expect(await events(id)).toMatchObject([{ type: 'CreditReserved', actorId: null }]);
  });

  it('a late success after a timeout cancel sends a second release, once', async () => {
    const id = await seed('Reserving-Credit');
    await transition(t.db, {
      errandId: id,
      expected: 'Reserving-Credit',
      to: 'Cancelled',
      actor: SYSTEM,
      set: { cancellationReason: 'CREDIT_TIMEOUT' },
    });
    expect(await releases(id)).toHaveLength(1); // the defensive one from the timeout

    const eventId = randomUUID();
    const payload = { errandId: id, requesterUserId: requester, reservedAmount: 5, creditTransactionId: randomUUID() };
    await deliver('credit.reservation-success.v1', payload, eventId);
    await deliver('credit.reservation-success.v1', payload, eventId); // redelivery

    expect((await row(id)).status).toBe('Cancelled');
    expect(await releases(id)).toHaveLength(2);
  });

  it('a reservation rejection cancels with credit\'s reason and sends no release', async () => {
    const id = await seed('Reserving-Credit');
    await deliver('credit.reservation-rejected.v1', {
      errandId: id,
      requesterUserId: requester,
      requestedAmount: 5,
      rejectionReason: 'MISSING_BALANCE',
    });

    expect(await row(id)).toMatchObject({ status: 'Cancelled', cancellationReason: 'MISSING_BALANCE' });
    expect(await releases(id)).toHaveLength(0);
  });

  it('an adjustment success applies the new amount; the log rebuilds the row', async () => {
    const id = await seed('Adjusting-Credit');
    await deliver('credit.reservation-adjustment-success.v1', {
      errandId: id,
      newReservedAmount: 9,
      creditTransactionId: randomUUID(),
    });

    expect(await row(id)).toMatchObject({ status: 'Open', rewardCredits: 9 });
    expect((await events(id))[0]).toMatchObject({ type: 'CreditAdjusted' });
  });

  it('an adjustment rejection leaves the amount and records the reason', async () => {
    const id = await seed('Adjusting-Credit');
    await deliver('credit.reservation-adjustment-rejected.v1', {
      errandId: id,
      requestedAmount: 9,
      rejectionReason: 'INSUFFICIENT_CREDITS',
    });

    expect(await row(id)).toMatchObject({ status: 'Open', rewardCredits: 5 });
    expect((await events(id))[0]).toMatchObject({
      type: 'CreditAdjustmentFailed',
      payload: { reason: 'INSUFFICIENT_CREDITS' },
    });
  });

  it('a transfer success completes; a transfer rejection reverts to Delivered', async () => {
    const ok = await seed('Transferring-Credit');
    await deliver('credit.transfer-succeeded.v1', {
      errandId: ok,
      requesterUserId: requester,
      courierUserId: courier,
      transferredAmount: 5,
      creditTransactionId: randomUUID(),
    });
    expect((await row(ok)).status).toBe('Completed');

    const failed = await seed('Transferring-Credit');
    await deliver('credit.transfer-rejected.v1', {
      errandId: failed,
      requesterUserId: requester,
      courierUserId: courier,
      rejectionReason: 'DESTINATION_ARCHIVED',
    });
    expect((await row(failed)).status).toBe('Delivered');
    expect((await events(failed))[0]).toMatchObject({
      type: 'CreditTransferFailed',
      payload: { reason: 'DESTINATION_ARCHIVED' },
    });
    expect(await rebuildProjection(t.db, failed)).toMatchObject({ status: 'Delivered' });
  });

  it('a stale reply for the wrong status is acked and changes nothing', async () => {
    const id = await seed('Delivered');
    expect(
      await deliver('credit.transfer-succeeded.v1', {
        errandId: id,
        requesterUserId: requester,
        courierUserId: courier,
        transferredAmount: 5,
        creditTransactionId: randomUUID(),
      }),
    ).toEqual({ outcome: 'ack' });
    expect((await row(id)).status).toBe('Delivered');
    expect(await events(id)).toHaveLength(0);
  });

  it('a release rejection only logs', async () => {
    const id = await seed('Cancelled');
    expect(
      await deliver('credit.release-rejected.v1', {
        errandId: id,
        requesterUserId: requester,
        rejectionReason: 'RESERVATION_NOT_FOUND',
      }),
    ).toEqual({ outcome: 'ack' });
    expect(await events(id)).toHaveLength(0);
  });
});
