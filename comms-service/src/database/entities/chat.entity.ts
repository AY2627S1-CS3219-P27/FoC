import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { ChatArchive } from './chat-archive.entity.js';
import { ChatLifecycleEvent } from './chat-lifecycle-event.entity.js';

export type ChatState = 'ACTIVE' | 'GRACE' | 'ARCHIVED';
export type ChatCloseReason =
  'ERRAND_DELIVERED' | 'COURIER_CANCELLED' | 'ERRAND_CANCELLED';

@Entity({ name: 'chats' })
@Index('UQ_chats_acceptance_event', ['acceptanceEventId'], { unique: true })
@Index('UQ_chats_archive', ['archiveId'], {
  unique: true,
  where: 'archive_id IS NOT NULL',
})
@Index('IDX_chats_requester_state_updated_id', [
  'requesterUserId',
  'state',
  'updatedAt',
  'id',
])
@Index('IDX_chats_courier_state_updated_id', [
  'courierUserId',
  'state',
  'updatedAt',
  'id',
])
@Index('IDX_chats_errand_state', ['errandId', 'state'])
@Index('IDX_chats_due_grace', ['closesAt', 'id'], {
  where: "state = 'GRACE' AND archive_id IS NULL",
})
@Check('CHK_chats_participants', 'requester_user_id <> courier_user_id')
@Check('CHK_chats_next_sequence', 'next_sequence > 0')
@Check(
  'CHK_chats_close_reason',
  `close_reason IS NULL
   OR close_reason IN ('ERRAND_DELIVERED', 'COURIER_CANCELLED', 'ERRAND_CANCELLED')`,
)
@Check(
  'CHK_chats_state',
  `(state = 'ACTIVE' AND closes_at IS NULL AND close_reason IS NULL AND archive_id IS NULL)
   OR (state = 'GRACE' AND closes_at IS NOT NULL AND close_reason IS NOT NULL AND archive_id IS NULL)
   OR (state = 'ARCHIVED' AND closes_at IS NOT NULL AND close_reason IS NOT NULL AND archive_id IS NOT NULL)`,
)
@Check(
  'CHK_chats_archive_claim',
  `(archive_claim_token IS NULL AND archive_claim_expires_at IS NULL)
   OR (archive_claim_token IS NOT NULL AND archive_claim_expires_at IS NOT NULL
       AND archive_claim_expires_at > created_at AND state = 'GRACE' AND archive_id IS NULL)`,
)
export class Chat {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'acceptance_event_id', type: 'uuid' })
  acceptanceEventId: string;

  @ManyToOne(() => ChatLifecycleEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'acceptance_event_id',
    foreignKeyConstraintName: 'FK_chats_acceptance_event',
  })
  acceptanceEvent: Relation<ChatLifecycleEvent>;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @Column({ name: 'requester_user_id', type: 'uuid' })
  requesterUserId: string;

  @Column({ name: 'courier_user_id', type: 'uuid' })
  courierUserId: string;

  @Column({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;

  @Column({ type: 'text', default: 'ACTIVE' })
  state: ChatState;

  @Column({ name: 'closes_at', type: 'timestamptz', nullable: true })
  closesAt: Date | null;

  @Column({ name: 'close_reason', type: 'text', nullable: true })
  closeReason: ChatCloseReason | null;

  @Column({ name: 'next_sequence', type: 'bigint', default: 1 })
  nextSequence: string;

  @Column({ name: 'archive_id', type: 'uuid', nullable: true })
  archiveId: string | null;

  @OneToOne(() => ChatArchive, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'archive_id',
    foreignKeyConstraintName: 'FK_chats_archive',
  })
  archive: Relation<ChatArchive> | null;

  @Column({ name: 'archive_claim_token', type: 'uuid', nullable: true })
  archiveClaimToken: string | null;

  @Column({
    name: 'archive_claim_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  archiveClaimExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
