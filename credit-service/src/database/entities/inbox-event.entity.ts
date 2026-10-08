import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { CreditAllocation } from './credit-allocation.entity.js';
import { CreditTransaction } from './credit-transaction.entity.js';
import { OutboxEvent } from './outbox-event.entity.js';

/** Durable evidence that an incoming event produced a known business outcome. */
@Entity({ name: 'inbox_events' })
@Check(
  'CHK_inbox_events_has_outcome',
  'outcome_allocation_id IS NOT NULL OR outcome_transaction_id IS NOT NULL OR outcome_outbox_event_id IS NOT NULL',
)
export class InboxEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;

  @Column({ name: 'outcome_allocation_id', type: 'uuid', nullable: true })
  outcomeAllocationId: string | null;

  @ManyToOne(() => CreditAllocation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'outcome_allocation_id',
    foreignKeyConstraintName: 'FK_inbox_events_outcome',
  })
  outcomeAllocation: CreditAllocation | null;

  @Column({ name: 'outcome_transaction_id', type: 'uuid', nullable: true })
  outcomeTransactionId: string | null;

  @ManyToOne(() => CreditTransaction, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'outcome_transaction_id',
    foreignKeyConstraintName: 'FK_inbox_events_outcome_transaction',
  })
  outcomeTransaction: CreditTransaction | null;

  @Column({ name: 'outcome_outbox_event_id', type: 'uuid', nullable: true })
  outcomeOutboxEventId: string | null;

  @ManyToOne(() => OutboxEvent, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'outcome_outbox_event_id',
    foreignKeyConstraintName: 'FK_inbox_events_outcome_outbox',
  })
  outcomeOutboxEvent: OutboxEvent | null;
}
