import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/** Event persisted atomically with domain state and published asynchronously. */
@Entity({ name: 'outbox_events' })
@Check('CHK_outbox_events_attempt_count', 'attempt_count >= 0')
@Index('IDX_outbox_events_unpublished_created_at', ['createdAt'], {
  where: 'published_at IS NULL',
})
export class OutboxEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType: string;

  @Column({ name: 'routing_key', type: 'text' })
  routingKey: string;

  @Column({ type: 'jsonb' })
  envelope: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'claimed_by', type: 'text', nullable: true })
  claimedBy: string | null;

  @Column({ name: 'claimed_until', type: 'timestamptz', nullable: true })
  claimedUntil: Date | null;
}
