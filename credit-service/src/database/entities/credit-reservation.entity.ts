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
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../bigint.transformer.js';
import { CreditAccount } from './credit-account.entity.js';
import { CreditTransaction } from './credit-transaction.entity.js';

export const CREDIT_RESERVATION_STATUSES = [
  'ACTIVE',
  'TRANSFERRED',
  'RELEASED',
] as const;
export type CreditReservationStatus =
  (typeof CREDIT_RESERVATION_STATUSES)[number];

/** Current Credit-owned reservation state for one errand. */
@Entity({ name: 'credit_reservations' })
@Check('CHK_credit_reservations_reserved_amount', 'reserved_amount > 0')
@Check(
  'CHK_credit_reservations_status',
  "status IN ('ACTIVE', 'TRANSFERRED', 'RELEASED')",
)
@Index('UQ_credit_reservations_errand', ['errandId'], { unique: true })
@Index('IDX_credit_reservations_active_requester', ['requesterUserId'], {
  where: "status = 'ACTIVE'",
})
@Index('UQ_credit_reservations_latest_transaction', ['latestTransactionId'], {
  unique: true,
})
export class CreditReservation {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @Column({ name: 'requester_user_id', type: 'uuid' })
  requesterUserId: string;

  @ManyToOne(() => CreditAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requester_user_id',
    foreignKeyConstraintName: 'FK_credit_reservations_requester',
  })
  requesterAccount: CreditAccount;

  @Column({
    name: 'reserved_amount',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  reservedAmount: number;

  @Column({ type: 'text' })
  status: CreditReservationStatus;

  @Column({ name: 'latest_transaction_id', type: 'uuid' })
  latestTransactionId: string;

  @OneToOne(() => CreditTransaction, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'latest_transaction_id',
    foreignKeyConstraintName: 'FK_credit_reservations_latest_transaction',
  })
  latestTransaction: CreditTransaction;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
