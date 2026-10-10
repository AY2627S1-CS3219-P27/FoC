import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../bigint.transformer.js';
import { CreditTransaction } from './credit-transaction.entity.js';
import { OutboxEvent } from './outbox-event.entity.js';

export const CREDIT_OPERATION_TYPES = [
  'RESERVE',
  'ADJUST',
  'TRANSFER',
  'RELEASE',
] as const;
export type CreditOperationType = (typeof CREDIT_OPERATION_TYPES)[number];

export const CREDIT_OPERATION_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'REJECTED',
] as const;
export type CreditOperationStatus = (typeof CREDIT_OPERATION_STATUSES)[number];

/** Durable execution state for one semantic credit lifecycle operation. */
@Entity({ name: 'credit_operations' })
@Check('CHK_credit_operations_amount', 'amount > 0')
@Check('CHK_credit_operations_attempt_count', 'attempt_count >= 0')
@Check(
  'CHK_credit_operations_type',
  "operation_type IN ('RESERVE', 'ADJUST', 'TRANSFER', 'RELEASE')",
)
@Check(
  'CHK_credit_operations_status',
  "status IN ('PENDING', 'SUCCEEDED', 'REJECTED')",
)
@Check(
  'CHK_credit_operations_participants',
  "(operation_type = 'TRANSFER' AND courier_user_id IS NOT NULL AND courier_user_id <> requester_user_id) OR (operation_type <> 'TRANSFER' AND courier_user_id IS NULL)",
)
@Check(
  'CHK_credit_operations_requester',
  "operation_type = 'ADJUST' OR requester_user_id IS NOT NULL",
)
@Check(
  'CHK_credit_operations_adjustment_command',
  "(operation_type = 'ADJUST' AND command_event_id IS NOT NULL AND expected_amount IS NOT NULL AND expected_amount > 0) OR (operation_type <> 'ADJUST' AND command_event_id IS NULL AND expected_amount IS NULL)",
)
@Check(
  'CHK_credit_operations_claim',
  "((claimed_by IS NULL) = (claimed_until IS NULL)) AND (claimed_by IS NULL OR status = 'PENDING')",
)
@Check(
  'CHK_credit_operations_outcome',
  "(status = 'PENDING' AND rejection_reason IS NULL AND completion_transaction_id IS NULL AND outcome_outbox_event_id IS NULL) OR (status = 'SUCCEEDED' AND rejection_reason IS NULL AND completion_transaction_id IS NOT NULL AND outcome_outbox_event_id IS NOT NULL) OR (status = 'REJECTED' AND rejection_reason IS NOT NULL AND completion_transaction_id IS NULL AND outcome_outbox_event_id IS NOT NULL)",
)
@Index(
  'UQ_credit_operations_lifecycle_errand_type',
  ['errandId', 'operationType'],
  {
    unique: true,
    where: "operation_type IN ('RESERVE', 'TRANSFER', 'RELEASE')",
  },
)
@Index('UQ_credit_operations_adjustment_event', ['commandEventId'], {
  unique: true,
  where: "operation_type = 'ADJUST'",
})
@Index(
  'IDX_credit_operations_pending_due',
  ['nextAttemptAt', 'createdAt', 'id'],
  { where: "status = 'PENDING'" },
)
@Index('IDX_credit_operations_pending_claim_expiry', ['claimedUntil', 'id'], {
  where: "status = 'PENDING' AND claimed_until IS NOT NULL",
})
@Index('IDX_credit_operations_completion_transaction', [
  'completionTransactionId',
])
@Index('UQ_credit_operations_outcome_outbox', ['outcomeOutboxEventId'], {
  unique: true,
  where: 'outcome_outbox_event_id IS NOT NULL',
})
export class CreditOperation {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @Column({ name: 'operation_type', type: 'text' })
  operationType: CreditOperationType;

  @Column({ type: 'text' })
  status: CreditOperationStatus;

  @Column({ name: 'requester_user_id', type: 'uuid', nullable: true })
  requesterUserId: string | null;

  @Column({ name: 'courier_user_id', type: 'uuid', nullable: true })
  courierUserId: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({
    name: 'expected_amount',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  expectedAmount: number | null;

  @Column({ name: 'command_event_id', type: 'uuid', nullable: true })
  commandEventId: string | null;

  @Column({ name: 'request_payload_hash', type: 'char', length: 64 })
  requestPayloadHash: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ name: 'claimed_by', type: 'text', nullable: true })
  claimedBy: string | null;

  @Column({ name: 'claimed_until', type: 'timestamptz', nullable: true })
  claimedUntil: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'completion_transaction_id', type: 'uuid', nullable: true })
  completionTransactionId: string | null;

  @ManyToOne(() => CreditTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completion_transaction_id',
    foreignKeyConstraintName: 'FK_credit_operations_completion_transaction',
  })
  completionTransaction: CreditTransaction | null;

  @Column({ name: 'outcome_outbox_event_id', type: 'uuid', nullable: true })
  outcomeOutboxEventId: string | null;

  @ManyToOne(() => OutboxEvent, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'outcome_outbox_event_id',
    foreignKeyConstraintName: 'FK_credit_operations_outcome_outbox',
  })
  outcomeOutboxEvent: OutboxEvent | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
