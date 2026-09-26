import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { errandEvents, errands } from '../db/schema.js';
import type { Db } from './transition.js';

export interface CreateInput {
  requesterId: string;
  supplierId: string;
  deliveryLocation: string;
  rewardCredits: number;
  pickupLocation?: string;
  description?: string;
  expiresAt?: Date;
  idempotencyKey?: string; // scoped to the requester; no key = no dedupe
}

export type CreateResult = { ok: true; errandId: string; replayed?: true };

// Not a transition: there is no from-status. Writes the errand and event 1
// together, so the log starts at ErrandCreated.
export function createErrand(db: Db, i: CreateInput): Promise<CreateResult> {
  return db.transaction(async (tx): Promise<CreateResult> => {
    const [row] = await tx
      .insert(errands)
      .values({
        ...i,
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
        payload: {},
        actorId: i.requesterId,
      });
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
    return { ok: true, errandId: prior.id, replayed: true };
  });
}
