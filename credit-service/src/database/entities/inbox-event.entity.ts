import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { CreditAllocation } from './credit-allocation.entity.js';

/** Durable evidence that an incoming event produced a known business outcome. */
@Entity({ name: 'inbox_events' })
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

  @Column({ name: 'outcome_allocation_id', type: 'uuid' })
  outcomeAllocationId: string;

  @ManyToOne(() => CreditAllocation, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'outcome_allocation_id',
    foreignKeyConstraintName: 'FK_inbox_events_outcome',
  })
  outcomeAllocation: CreditAllocation;
}
