import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { bigintTransformer } from '../bigint.transformer.js';
import { CreditAccount } from './credit-account.entity.js';

export const CREDIT_TRANSACTION_TYPES = [
  'RESERVATION',
  'RESERVATION_ADJUSTMENT',
  'TRANSFER',
  'RELEASE',
] as const;
export type CreditTransactionType = (typeof CREDIT_TRANSACTION_TYPES)[number];

export const BALANCE_TYPES = ['CREDIT_BALANCE', 'RESERVED_BALANCE'] as const;
export type BalanceType = (typeof BALANCE_TYPES)[number];

/** Immutable record of one effective movement between account buckets. */
@Entity({ name: 'credit_transactions' })
@Check('CHK_credit_transactions_amount', 'amount > 0')
@Check(
  'CHK_credit_transactions_type',
  "type IN ('RESERVATION', 'RESERVATION_ADJUSTMENT', 'TRANSFER', 'RELEASE')",
)
@Check(
  'CHK_credit_transactions_origin_balance_type',
  "origin_balance_type IN ('CREDIT_BALANCE', 'RESERVED_BALANCE')",
)
@Check(
  'CHK_credit_transactions_destination_balance_type',
  "destination_balance_type IN ('CREDIT_BALANCE', 'RESERVED_BALANCE')",
)
@Check(
  'CHK_credit_transactions_distinct_balance_types',
  'origin_balance_type <> destination_balance_type',
)
@Check(
  'CHK_credit_transactions_user_relationship',
  "(type = 'TRANSFER' AND origin_user_id <> destination_user_id) OR (type <> 'TRANSFER' AND origin_user_id = destination_user_id)",
)
@Check(
  'CHK_credit_transactions_direction',
  "(type = 'RESERVATION' AND origin_balance_type = 'CREDIT_BALANCE' AND destination_balance_type = 'RESERVED_BALANCE') OR type = 'RESERVATION_ADJUSTMENT' OR (type IN ('TRANSFER', 'RELEASE') AND origin_balance_type = 'RESERVED_BALANCE' AND destination_balance_type = 'CREDIT_BALANCE')",
)
@Index('IDX_credit_transactions_errand_created_at_id', [
  'errandId',
  'createdAt',
  'id',
])
@Index('IDX_credit_transactions_origin_user_created_at_id', [
  'originUserId',
  'createdAt',
  'id',
])
@Index('IDX_credit_transactions_destination_user_created_at_id', [
  'destinationUserId',
  'createdAt',
  'id',
])
export class CreditTransaction {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'text' })
  type: CreditTransactionType;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @Column({ name: 'origin_balance_type', type: 'text' })
  originBalanceType: BalanceType;

  @Column({ name: 'destination_balance_type', type: 'text' })
  destinationBalanceType: BalanceType;

  @Column({ name: 'origin_user_id', type: 'uuid' })
  originUserId: string;

  @ManyToOne(() => CreditAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'origin_user_id',
    foreignKeyConstraintName: 'FK_credit_transactions_origin_user',
  })
  originAccount: CreditAccount;

  @Column({ name: 'destination_user_id', type: 'uuid' })
  destinationUserId: string;

  @ManyToOne(() => CreditAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'destination_user_id',
    foreignKeyConstraintName: 'FK_credit_transactions_destination_user',
  })
  destinationAccount: CreditAccount;

  @Column({ name: 'errand_id', type: 'uuid' })
  errandId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
