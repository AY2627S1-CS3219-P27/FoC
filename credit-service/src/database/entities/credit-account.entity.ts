import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { bigintTransformer } from '../bigint.transformer.js';

/**
 * Current balances owned by one platform user.
 * `creditBalance` is spendable; `reservedBalance` is held for future work.
 */
@Entity({ name: 'credit_accounts' })
@Check('CHK_credit_accounts_credit_balance', 'credit_balance >= 0')
@Check('CHK_credit_accounts_reserved_balance', 'reserved_balance >= 0')
export class CreditAccount {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'credit_balance',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  creditBalance: number;

  @Column({
    name: 'reserved_balance',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  reservedBalance: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ type: 'integer', default: 1 })
  version: number;
}
