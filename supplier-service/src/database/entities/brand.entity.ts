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
 * A brand groups suppliers that are branches of the same business (F3).
 * Suppliers reference a brand by id, so renaming never breaks them; brands
 * are retired, never deleted, and suppliers that already hold a retired
 * brand keep it (F3.3.1, F1.8).
 */
@Entity({ name: 'brands' })
@Check('CHK_brands_name', `length(btrim(name)) > 0`)
// Names are unique among non-retired brands only, case-insensitive (F3.2): a
// retired brand's name may be reused.
@Index('UQ_brands_name_key_active', ['nameKey'], {
  unique: true,
  where: '(retired_at IS NULL)',
})
export class Brand {
  /** System-generated and immutable (F3.1). */
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_brands' })
  id: string;

  /** 1-100 characters (F3.1). */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** nameKey(name): the case-insensitive comparison key (F3.2). */
  @Column({ name: 'name_key', type: 'text' })
  nameKey: string;

  /** Null while the brand is in use. */
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
