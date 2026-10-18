import { OutboxEvent } from '@foc/outbox/outbox-event.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

/**
 * A supplier-validation request already answered (F15.7.3), as in
 * credit-service. The request's event id is the key, so a redelivered
 * request is recognised and acknowledged without a second reply (F15.7.4).
 * The row and its reply in the outbox are written in one transaction.
 */
@Entity({ name: 'inbox_events' })
export class InboxEvent {
  @PrimaryColumn({
    name: 'event_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_inbox_events',
  })
  eventId: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType: string;

  /** SHA-256 of the payload, to spot one event id reused for other content. */
  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;

  /** The reply this request produced: exactly one per request (F15.7.2). */
  @Column({ name: 'reply_event_id', type: 'uuid' })
  replyEventId: string;

  @ManyToOne(() => OutboxEvent, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reply_event_id',
    foreignKeyConstraintName: 'FK_inbox_events_reply',
  })
  reply: OutboxEvent;
}
