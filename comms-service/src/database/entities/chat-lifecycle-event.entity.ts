import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { InboxEvent } from './inbox-event.entity.js';

export type ChatLifecycleKind =
  | 'ERRAND_ACCEPTED'
  | 'ERRAND_DELIVERED'
  | 'COURIER_CANCELLED'
  | 'ERRAND_CANCELLED';

@Entity({ name: 'chat_lifecycle_events' })
@Index('IDX_chat_lifecycle_events_errand_kind_occurred_event', [
  'errandId',
  'kind',
  'occurredAt',
  'sourceEventId',
])
@Index(
  'IDX_chat_lifecycle_events_participants_errand_occurred',
  ['requesterUserId', 'courierUserId', 'errandId', 'occurredAt'],
  { where: 'requester_user_id IS NOT NULL AND courier_user_id IS NOT NULL' },
)
@Check(
  'CHK_chat_lifecycle_events_kind',
  `kind IN ('ERRAND_ACCEPTED', 'ERRAND_DELIVERED', 'COURIER_CANCELLED', 'ERRAND_CANCELLED')`,
)
@Check(
  'CHK_chat_lifecycle_events_participants',
  `(kind = 'ERRAND_CANCELLED' AND requester_user_id IS NULL AND courier_user_id IS NULL)
   OR (kind <> 'ERRAND_CANCELLED' AND requester_user_id IS NOT NULL
       AND courier_user_id IS NOT NULL AND requester_user_id <> courier_user_id)`,
)
@Check(
  'CHK_chat_lifecycle_events_deadline',
  `(kind = 'ERRAND_ACCEPTED' AND derived_close_at IS NULL)
   OR (kind = 'ERRAND_DELIVERED' AND derived_close_at = occurred_at + interval '3 hours')
   OR (kind IN ('COURIER_CANCELLED', 'ERRAND_CANCELLED')
       AND derived_close_at = occurred_at + interval '30 minutes')`,
)
@Check(
  'CHK_chat_lifecycle_events_evidence',
  `jsonb_typeof(envelope) = 'object' AND jsonb_typeof(payload) = 'object'`,
)
export class ChatLifecycleEvent {
  @PrimaryColumn({ name: 'source_event_id', type: 'uuid' })
  sourceEventId: string;

  @OneToOne(() => InboxEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'source_event_id',
    foreignKeyConstraintName: 'FK_chat_lifecycle_events_inbox',
  })
  inboxEvent: Relation<InboxEvent>;

  @Column({ type: 'text' })
  kind: ChatLifecycleKind;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @Column({ name: 'requester_user_id', type: 'uuid', nullable: true })
  requesterUserId: string | null;

  @Column({ name: 'courier_user_id', type: 'uuid', nullable: true })
  courierUserId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ name: 'derived_close_at', type: 'timestamptz', nullable: true })
  derivedCloseAt: Date | null;

  @Column({ type: 'jsonb' })
  envelope: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;
}
