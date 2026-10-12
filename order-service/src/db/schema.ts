import { sql } from 'drizzle-orm';
import {
  check,
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CANCELLATION_REASONS } from '../lifecycle/edges.js';
import { ACTIVE_STATUSES, statusEnum } from '../lifecycle/status.js';

export { statusEnum };

export const COURIER_LOCK_INDEX = 'errands_one_active_per_courier';

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

    //columns here are to allow for sorting and filtering
    courierId: uuid('courier_id'),
    supplierId: uuid('supplier_id').notNull(),
    description: text('description'), // optional delivery instructions
    pickupLocation: text('pickup_location'),
    deliveryLocation: text('delivery_location').notNull(),
    rewardCredits: integer('reward_credits').notNull(),

    // Decided (D2): set on Reserving-Credit -> Open as that time + the requester's
    // duration (F1.7.3). Not implemented yet: today the requester supplies it
    // at creation.
    expiresAt: ts('expires_at'),
    pickedUpAt: ts('picked_up_at'), // starts the 24h Picked Up -> Cancelled timer
    deliveredAt: ts('delivered_at'), // starts the 24h Delivered -> Completed timer (D3)

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
    // One active errand per courier (L5, F5.6); keep in step with the accept edge.
    uniqueIndex(COURIER_LOCK_INDEX)
      .on(t.courierId)
      .where(
        sql`${t.status} IN (${sql.join(
          ACTIVE_STATUSES.map((s) => sql.raw(`'${s}'`)),
          sql`, `,
        )})`,
      ),
    check(
      'errands_cancellation_reason_valid',
      sql`${t.cancellationReason} IN (${sql.join(
        CANCELLATION_REASONS.map((r) => sql.raw(`'${r}'`)),
        sql`, `,
      )})`,
    ),
    index().on(t.requesterId, t.status),
  ],
);

// Event store
export const errandEvents = pgTable(
  'errand_events',
  {
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    sequenceNumber: integer('sequence_number').notNull(), // issued by errands.last_sequence_number
    type: text('type').notNull(),
    fromStatus: statusEnum('from_status'), // null on ErrandCreated (ADR 0005)
    toStatus: statusEnum('to_status').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: jsonb('payload').notNull(), //relavent information regarding each state will be stored here
    actorId: uuid('actor_id'), // null = system actor (sweeps, credit and supplier replies)
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.errandId, t.sequenceNumber] })],
);

// Strict replay: the first outcome for a key, stored verbatim.
// No FK: a NOT_FOUND outcome is stored too.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    errandId: uuid('errand_id').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(), // expected|to|actor|type|hash(set, payload)
    outcome: jsonb('outcome'), // set before the claiming transaction commits
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.errandId, t.key] })],
);

// Transactional outbox (credit ADR 0004): notices are inserted in the same
// transaction as the state change and published to the broker by the relay.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    eventId: uuid('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    routingKey: text('routing_key').notNull(),
    envelope: jsonb('envelope').$type<Record<string, unknown>>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    claimedBy: text('claimed_by'),
    claimedUntil: ts('claimed_until'),
  },
  (t) => [
    check('outbox_events_attempt_count_check', sql`${t.attemptCount} >= 0`),
    //publisher only cares about the evemts that have not been published
    index('outbox_events_unpublished_idx')
      .on(t.nextAttemptAt, t.createdAt, t.eventId)
      .where(sql`${t.publishedAt} IS NULL`),  
  ],
);
