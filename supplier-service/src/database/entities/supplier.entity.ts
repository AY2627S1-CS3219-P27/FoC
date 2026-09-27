import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Building } from './building.entity.js';
import { SupplierCategory } from './supplier-category.entity.js';

/** Exactly one of these per supplier (F1.2.2). */
export enum SupplierKind {
  Store = 'Store',
  Facility = 'Facility',
  Landmark = 'Landmark',
}

/** Suppliers are created Active (F9.1). */
export enum SupplierStatus {
  Active = 'Active',
  Inactive = 'Inactive',
}

/**
 * One physical pickup point (F1). The database enforces the duplicate rule
 * (F1.5.2: two concurrent submissions cannot both succeed) and every
 * single-column rule it can express; the campus bounding box (F1.2.7) and
 * "at least one category" (F1.2.3) are checked by the service in the same
 * transaction.
 */
@Entity({ name: 'suppliers' })
@Unique('UQ_suppliers_name_key_building_floor', [
  'nameKey',
  'buildingId',
  'floor',
])
@Index('IDX_suppliers_building_id', ['buildingId'])
@Check('CHK_suppliers_name', `length(btrim(name)) BETWEEN 1 AND 100`)
@Check('CHK_suppliers_floor', `floor ~ '^(B[1-9]|[1-9][0-9]?|M)$'`)
@Check(
  'CHK_suppliers_location_description',
  `length(btrim(location_description)) > 0`,
)
@Check('CHK_suppliers_latitude', `latitude BETWEEN -90 AND 90`)
@Check('CHK_suppliers_longitude', `longitude BETWEEN -180 AND 180`)
export class Supplier {
  /** System-generated, immutable, never reused (F1.1). */
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_suppliers' })
  id: string;

  /** Stored trimmed; 1-100 characters (F1.2.1). */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** nameKey(name): the F1.5 duplicate-detection key */
  @Column({ name: 'name_key', type: 'text' })
  nameKey: string;

  @Column({ type: 'enum', enum: SupplierKind, enumName: 'supplier_kind' })
  kind: SupplierKind;

  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  @ManyToOne(() => Building, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'building_id',
    foreignKeyConstraintName: 'FK_suppliers_building',
  })
  building?: Building;

  /** Stored upper-cased: B1-B9, 1-99 or M (F1.2.5). */
  @Column({ type: 'varchar', length: 2 })
  floor: string;

  /** How to find it within the building, e.g. "Next to LT19" (F1.2.6). */
  @Column({ name: 'location_description', type: 'varchar', length: 255 })
  locationDescription: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  /** Optional (F1.2.9); a placeholder is returned when absent. */
  @Column({ name: 'photo_url', type: 'varchar', length: 2048, nullable: true })
  photoUrl: string | null;

  @Column({
    type: 'enum',
    enum: SupplierStatus,
    enumName: 'supplier_status',
    default: SupplierStatus.Active,
  })
  status: SupplierStatus;

  /** 1 on creation, +1 on every committed change (F1.3.1). */
  @VersionColumn({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => SupplierCategory, (link) => link.supplier)
  categoryLinks?: SupplierCategory[];
}
