import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { errandEvents, errands } from '../db/schema.js';
import { enqueueSupplierRequest } from './notice.js';
import type { Db } from './transition.js';

export interface CreateRequestInputs {
  requesterId: string;
  supplierId: string;
  deliveryLocation: string;
  rewardCredits: number;
  pickupLocation?: string;
  description?: string;
  expiryDurationMinutes: number; // ADR 0007; expiresAt is set when the errand goes Open
  collectionItems: string; // what the courier collects; kept in the ErrandCreated payload only
  idempotencyKey?: string; // scoped to the requester; no key = no dedupe
}

export type CreateResult =
  | { ok: true; errandId: string; replayed?: true }
  | { ok: false; reason: 'INVALID_FIELDS' | 'IDEMPOTENCY_KEY_REUSED' };

// F1.7.2: 15 minutes to 168 hours.
export const MIN_EXPIRY_MINUTES = 15;
export const MAX_EXPIRY_MINUTES = 168 * 60;

// Not a transition: there is no from-status. Writes the errand and event 1
// together, so the log starts at ErrandCreated.
export function createErrand(db: Db, i: CreateRequestInputs): Promise<CreateResult> {
  const { expiryDurationMinutes, collectionItems, ...columns } = i;
  if (
    !Number.isInteger(expiryDurationMinutes) ||
    expiryDurationMinutes < MIN_EXPIRY_MINUTES ||
    expiryDurationMinutes > MAX_EXPIRY_MINUTES ||
    typeof collectionItems !== 'string' ||
    !collectionItems.trim()
  ) {
    return Promise.resolve({ ok: false, reason: 'INVALID_FIELDS' });
  }

  const request: Record<string, unknown> = {
    requesterId: i.requesterId,
    supplierId: i.supplierId,
    deliveryLocation: i.deliveryLocation,
    rewardCredits: i.rewardCredits,
    pickupLocation: i.pickupLocation ?? null,
    description: i.description ?? null,
    expiryDurationMinutes, // the Reserving-Credit -> Open edge turns this into expiresAt
    collectionItems,
  };
  return db.transaction(async (tx): Promise<CreateResult> => {
    const [row] = await tx
      .insert(errands)
      .values({
        ...columns,
        collectionItems,
        id: randomUUID(),
        status: 'Pending-Supplier',
        lastSequenceNumber: 1,
      })
      .onConflictDoNothing({
        target: [errands.requesterId, errands.idempotencyKey],
      })
      .returning({ id: errands.id });

    if (row) {
      await tx.insert(errandEvents).values({
        errandId: row.id,
        sequenceNumber: 1,
        type: 'ErrandCreated',
        fromStatus: null,
        toStatus: 'Pending-Supplier',
        payload: request,
        actorId: i.requesterId,
      });
      await enqueueSupplierRequest(tx, row.id, i.supplierId, 0);
      return { ok: true, errandId: row.id };
    }

    // Repeat key: the conflicting insert only returns after the winner commits.
    const [prior] = await tx
      .select({ id: errands.id })
      .from(errands)
      .where(
        and(
          eq(errands.requesterId, i.requesterId),
          eq(errands.idempotencyKey, i.idempotencyKey!),
        ),
      );
      
    const [first] = await tx
      .select({ payload: errandEvents.payload })
      .from(errandEvents)
      .where(
        and(eq(errandEvents.errandId, prior.id), eq(errandEvents.sequenceNumber, 1)),
      );
    const asked = first.payload as Record<string, unknown>;
    if (Object.keys(request).some((k) => request[k] !== asked[k])) {
      return { ok: false, reason: 'IDEMPOTENCY_KEY_REUSED' };
    }
    return { ok: true, errandId: prior.id, replayed: true };
  });
}
