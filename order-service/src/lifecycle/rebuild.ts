import { asc, eq } from 'drizzle-orm';
import { errandEvents, errands } from '../db/schema.js';
import type { Db } from './transition.js';

// The projection minus what events cannot supply: the idempotency key is
// request plumbing and the timestamps are row bookkeeping.
export type RebuiltErrand = Omit<
  typeof errands.$inferSelect,
  'idempotencyKey' | 'createdAt' | 'updatedAt'
>;

export type RebuildEvent = Pick<
  typeof errandEvents.$inferSelect,
  'errandId' | 'sequenceNumber' | 'toStatus' | 'payload'
>;

// Only these payload keys feed the projection; anything else a caller put in
// a payload is ignored.
const COLUMNS = [
  'requesterId',
  'supplierId',
  'deliveryLocation',
  'rewardCredits',
  'pickupLocation',
  'description',
  'expiresAt',
  'courierId',
  'pickedUpAt',
  'deliveredAt',
  'cancellationReason',
] as const;

// Stored as ISO strings in the payload, restored to Dates here.
const DATE_COLUMNS: readonly string[] = ['expiresAt', 'pickedUpAt', 'deliveredAt'];

// Pure replay: events in sequence order in, projection out.
export function foldEvents(events: RebuildEvent[]): RebuiltErrand | null {
  if (events.length === 0) return null;

  const state: Record<string, unknown> = {
    courierId: null,
    pickupLocation: null,
    description: null,
    expiresAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    cancellationReason: null,
  };

  events.forEach((e, idx) => {
    if (e.sequenceNumber !== idx + 1) {
      throw new Error(
        `errand ${e.errandId}: expected event ${idx + 1}, found ${e.sequenceNumber}`,
      );
    }
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    for (const col of COLUMNS) {
      if (!(col in payload)) continue;
      const v = payload[col];
      state[col] =
        DATE_COLUMNS.includes(col) && v != null ? new Date(v as string) : v;
    }
  });

  const last = events[events.length - 1];
  return {
    ...state,
    id: last.errandId,
    status: last.toStatus,
    lastSequenceNumber: last.sequenceNumber,
  } as RebuiltErrand;
}

// Read-only: never writes to errands. Only the transition path does.
export async function rebuildProjection(
  db: Db,
  errandId: string,
): Promise<RebuiltErrand | null> {
  const events = await db
    .select({
      errandId: errandEvents.errandId,
      sequenceNumber: errandEvents.sequenceNumber,
      toStatus: errandEvents.toStatus,
      payload: errandEvents.payload,
    })
    .from(errandEvents)
    .where(eq(errandEvents.errandId, errandId))
    .orderBy(asc(errandEvents.sequenceNumber));
  return foldEvents(events);
}
