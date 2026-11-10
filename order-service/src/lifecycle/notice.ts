import { createHash, randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  eventRegistry,
  type EventContractKey,
} from '@foc/contracts';
import { enqueueOutbox } from '../outbox/outbox.store.js';
import type { Db } from './transition.js';

// What an edge knows when it fires: the errand row after the UPDATE and the
// caller's payload.
export interface NoticeContext {
  errandId: string;
  requesterId: string;
  courierId: string | null;
  actorUserId: string | null;
  rewardCredits: number;
  settlementAmount: number | null; // courier's share, set once an admin settles
  settlementNote: string | null;
  payload: Record<string, unknown>;
  // Events of this edge's type on the errand, this one included (credit.settlement.v1).
  attempt: number;
  sequenceNumber: number; // of the event this edge writes
}

// `key` is the contract's routing key; builders may return undefined to skip, or several notices.
export interface Notice {
  key: EventContractKey;
  payload: object;
  eventId?: string; // a derived id a sweep can re-create; random when absent
}
export type NoticeBuilder = (c: NoticeContext) => Notice | Notice[] | undefined;

// Compiles every schema once.
const validator = new AccountEventContractValidator();

// Inside the transition's transaction: a notice that fails its contract throws,
// rolling the state change back rather than shipping a bad message.
export async function enqueueNotice(
  tx: Db,
  n: Notice,
  eventId: string = n.eventId ?? randomUUID(),
) {
  const contract = eventRegistry[n.key];
  const envelope = {
    eventId,
    eventType: contract.eventType,
    timestamp: new Date().toISOString(),
    publisher: contract.publisher,
    payload: n.payload,
  };
  const checked = validator.validate(n.key, envelope);
  if (!checked.valid) {
    throw new Error(
      `${n.key} failed its contract: ${JSON.stringify(checked.violations)}`,
    );
  }
  await enqueueOutbox(tx, {
    eventId: envelope.eventId,
    eventType: contract.eventType,
    routingKey: n.key,
    envelope,
  });
}

// A UUID derived from `seed`, so the same seed always yields the same event id.
const derivedUuid = (seed: string) => {
  const b = createHash('sha256').update(seed).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};


export const enqueueRelease = (db: Db, errandId: string, replyEventId: string) =>
  enqueueNotice(
    db,
    { key: 'order.errand-cancelled.v1', payload: { errandId } },
    derivedUuid(`release:${replyEventId}`),
  );

// Each attempt is a new question to Supplier Service, so a lost reply still gets answered.
export const supplierRequestId = (errandId: string, attempt: number) =>
  derivedUuid(`supplier-validation:${errandId}:${attempt}`);

// F2: a revalidation is a new question, keyed by the edit's event number, so
// supplier-service never sees one id with two different payloads.
export const supplierRevalidationId = (errandId: string, seq: number, attempt: number) =>
  derivedUuid(`supplier-revalidation:${errandId}:${seq}:${attempt}`);

export const supplierRequest = (
  errandId: string,
  supplierId: string,
  deliveryBuildingId: string,
  deliveryVenueId?: string | null,
): Notice => ({
  key: 'order.supplier-validation-requested.v1',
  payload: { errandId, supplierId, deliveryBuildingId, ...(deliveryVenueId && { deliveryVenueId }) },
});

export const enqueueSupplierRequest = (
  db: Db,
  errandId: string,
  supplierId: string,
  deliveryBuildingId: string,
  attempt: number,
  deliveryVenueId?: string | null,
) =>
  enqueueNotice(
    db,
    supplierRequest(errandId, supplierId, deliveryBuildingId, deliveryVenueId),
    supplierRequestId(errandId, attempt),
  );
