import { randomUUID } from 'node:crypto';
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
export async function enqueueNotice(tx: Db, n: Notice) {
  const contract = eventRegistry[n.key];
  const envelope = {
    eventId: randomUUID(),
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
