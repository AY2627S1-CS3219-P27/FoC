import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { statusEnum } from '../lifecycle/status.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// Projection: one row per errand, updated in the same transaction as each event.
export const errands = pgTable(
  'errands',
  {
    id: uuid('id').primaryKey(),
    requesterId: uuid('requester_id').notNull(),
    status: statusEnum('status').notNull(),
    lastSequenceNumber: integer('last_sequence_number').notNull().default(0),
    idempotencyKey: text('idempotency_key'),

    // projection columns (#351)
    courierId: uuid('courier_id'),
    supplierId: uuid('supplier_id').notNull(),
    description: text('description'), // optional delivery instructions
    pickupLocation: text('pickup_location'),
    deliveryLocation: text('delivery_location').notNull(),
    rewardCredits: integer('reward_credits').notNull(),

    expiresAt: ts('expires_at'), // requester-supplied at creation; Open lapses (ERRAND_EXPIRED)
    pickedUpAt: ts('picked_up_at'), // starts the 24h Picked Up -> Cancelled timer
    deliveredAt: ts('delivered_at'), // starts the 7d Delivered -> Completed timer

    cancellationReason: text('cancellation_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.requesterId, t.idempotencyKey),
    index().on(t.status, t.expiresAt),
    index().on(t.status, t.pickedUpAt),
    index().on(t.status, t.deliveredAt),
    index().on(t.courierId, t.status),
    index().on(t.requesterId, t.status),
  ],
);

// Append-only source of truth (ADR 0005).
export const errandEvents = pgTable(
  'errand_events',
  {
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    sequenceNumber: integer('sequence_number').notNull(), // issued by errands.last_sequence_number
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    fromStatus: statusEnum('from_status'), // null for ErrandCreated
    toStatus: statusEnum('to_status').notNull(),
    payload: jsonb('payload').notNull(),
    actorId: uuid('actor_id'), // system actor for sweep transitions
    idempotencyKey: text('idempotency_key'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.errandId, t.sequenceNumber] }),
    uniqueIndex()
      .on(t.errandId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);
