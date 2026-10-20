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
  rewardCredits: number;
  payload: Record<string, unknown>;
}

// `key` is the contract's routing key; builders may return undefined to skip.
export interface Notice {
  key: EventContractKey;
  payload: object;
}
export type NoticeBuilder = (c: NoticeContext) => Notice | undefined;

// Compiles every schema once.
const validator = new AccountEventContractValidator();

// Inside the transition's transaction: a notice that fails its contract throws,
// rolling the state change back rather than shipping a bad message.
export async function enqueueNotice(
  tx: Db,
  n: Notice,
  eventId: string = randomUUID(),
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

export const enqueueSupplierRequest = (
  db: Db,
  errandId: string,
  supplierId: string,
  attempt: number,
) =>
  enqueueNotice(
    db,
    { key: 'order.supplier-validation-requested.v1', payload: { errandId, supplierId } },
    supplierRequestId(errandId, attempt),
  );
