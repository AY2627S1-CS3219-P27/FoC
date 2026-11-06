import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Supplier } from './supplier.entity.js';

/**
 * One interval of a supplier's regular weekly opening hours (F2.1): the day
 * (0 = Monday to 6 = Sunday) and the opening and closing minute since
 * midnight, in Singapore time. An interval closing at or before its opening
 * minute is overnight and runs into the next day (F2.3). A supplier open
 * around the clock has `suppliers.open_24_hours` instead, and no rows (F2.2).
 * Overlaps cannot be written as a simple SQL rule, so the service refuses
 * them (F2.4). Deleting a supplier removes its intervals.
 */
@Entity({ name: 'supplier_opening_intervals' })
@Check('CHK_supplier_opening_intervals_day', `day BETWEEN 0 AND 6`)
@Check('CHK_supplier_opening_intervals_opens_at', `opens_at BETWEEN 0 AND 1439`)
@Check(
  'CHK_supplier_opening_intervals_closes_at',
  `closes_at BETWEEN 0 AND 1439`,
)
@Check('CHK_supplier_opening_intervals_differ', `opens_at <> closes_at`)
export class SupplierOpeningInterval {
  @PrimaryColumn({
    name: 'supplier_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_supplier_opening_intervals',
  })
  supplierId: string;

  @PrimaryColumn({
    type: 'smallint',
    primaryKeyConstraintName: 'PK_supplier_opening_intervals',
  })
  day: number;

  @PrimaryColumn({
    name: 'opens_at',
    type: 'smallint',
    primaryKeyConstraintName: 'PK_supplier_opening_intervals',
  })
  opensAt: number;

  @Column({ name: 'closes_at', type: 'smallint' })
  closesAt: number;

  @ManyToOne(() => Supplier, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'supplier_id',
    foreignKeyConstraintName: 'FK_supplier_opening_intervals_supplier',
  })
  supplier?: Supplier;
}
