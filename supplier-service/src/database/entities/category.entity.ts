import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A supplier category from the controlled set (F11). Suppliers reference
 * categories by id, so renaming never breaks them (F11.1); categories are
 * retired, never deleted (F11.3).
 */
@Entity({ name: 'categories' })
@Check('CHK_categories_name', `length(btrim(name)) > 0`)
// Names are unique among non-retired categories only, case-insensitive
// (F11.2.1): a retired category's name may be reused.
@Index('UQ_categories_name_key_active', ['nameKey'], {
  unique: true,
  where: '(retired_at IS NULL)',
})
export class Category {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_categories' })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  /** nameKey(name): the case-insensitive comparison key */
  @Column({ name: 'name_key', type: 'text' })
  nameKey: string;

  /** Null while the category is in use. */
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
