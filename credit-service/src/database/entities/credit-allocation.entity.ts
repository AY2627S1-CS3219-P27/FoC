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

/** 
 * Immutable record of credits issued by the platform to initialize an account. 
 * */
@Entity({ name: 'credit_allocations' })
@Check('CHK_credit_allocations_amount', 'amount > 0')
@Index('UQ_credit_allocations_user', ['userId'], { unique: true })
export class CreditAllocation {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => CreditAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_credit_allocations_user',
  })
  account: CreditAccount;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
