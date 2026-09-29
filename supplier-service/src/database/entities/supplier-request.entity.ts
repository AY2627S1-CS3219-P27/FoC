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
import { Building } from './building.entity.js';
import { Supplier } from './supplier.entity.js';

/** What a request asks for (F6.2). */
export enum RequestType {
  Create = 'Create',
  Update = 'Update',
  StatusChange = 'StatusChange',
}

/** Approved, Denied and Withdrawn are final (F6.1). */
export enum RequestState {
  Pending = 'Pending',
  Approved = 'Approved',
  Denied = 'Denied',
  Withdrawn = 'Withdrawn',
}

/**
 * A basic user's request to create, update or change the status of a
 * supplier, moderated by an admin (F6). Every rule about which fields a
 * request of each type and state must carry is a named CHECK, so the
 * database refuses an inconsistent row whatever the code does.
 *
 * User ids (`submittedBy`, `resolvedBy`) are text: user-service ids are
 * numbers today and are moving to UUIDs, and text holds both.
 */
@Entity({ name: 'supplier_requests' })
// Create requests carry the duplicate key; the others target a supplier.
@Check(
  'CHK_supplier_requests_target',
  `(type = 'Create' AND supplier_id IS NULL AND supplier_version IS NULL
     AND name_key IS NOT NULL AND building_id IS NOT NULL AND floor IS NOT NULL)
   OR (type <> 'Create' AND supplier_id IS NOT NULL AND supplier_version IS NOT NULL
     AND name_key IS NULL AND building_id IS NULL AND floor IS NULL)`,
)
@Check(
  'CHK_supplier_requests_resolution',
  `(state = 'Pending' AND resolved_by IS NULL AND resolved_at IS NULL)
   OR (state <> 'Pending' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)`,
)
// A denial always has a reason, and only a denial has one (F6.4).
@Check(
  'CHK_supplier_requests_denial_reason',
  `(state = 'Denied') = (denial_reason IS NOT NULL)
   AND (denial_reason IS NULL OR length(btrim(denial_reason)) > 0)`,
)
@Check(
  'CHK_supplier_requests_created_supplier',
  `created_supplier_id IS NULL OR (type = 'Create' AND state = 'Approved')`,
)
// Only one Pending creation request per duplicate key (F7.2).
@Index(
  'UQ_supplier_requests_pending_create',
  ['nameKey', 'buildingId', 'floor'],
  { unique: true, where: `type = 'Create' AND state = 'Pending'` },
)
// The admin queue: Pending requests by type, oldest first (F6.7).
@Index('IDX_supplier_requests_pending_queue', ['type', 'submittedAt'], {
  where: `state = 'Pending'`,
})
@Index('IDX_supplier_requests_submitted_by', ['submittedBy'])
export class SupplierRequest {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_supplier_requests',
  })
  id: string;

  @Column({
    type: 'enum',
    enum: RequestType,
    enumName: 'supplier_request_type',
  })
  type: RequestType;

  @Column({
    type: 'enum',
    enum: RequestState,
    enumName: 'supplier_request_state',
    default: RequestState.Pending,
  })
  state: RequestState;

  /** The target supplier (Update and StatusChange requests). */
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'supplier_id',
    foreignKeyConstraintName: 'FK_supplier_requests_supplier',
  })
  supplier?: Supplier;

  /** The supplier's version when the request was submitted (F6.2). */
  @Column({ name: 'supplier_version', type: 'integer', nullable: true })
  supplierVersion: number | null;

  /** The submitted values, already validated and normalised. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Create requests: the F1.5 duplicate key of the proposed supplier. */
  @Column({ name: 'name_key', type: 'text', nullable: true })
  nameKey: string | null;

  @Column({ name: 'building_id', type: 'uuid', nullable: true })
  buildingId: string | null;

  @ManyToOne(() => Building, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'building_id',
    foreignKeyConstraintName: 'FK_supplier_requests_building',
  })
  building?: Building;

  @Column({ type: 'varchar', length: 2, nullable: true })
  floor: string | null;

  /** The submitting user's id, from their access token (F13.1). */
  @Column({ name: 'submitted_by', type: 'text' })
  submittedBy: string;

  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;

  /** Who approved, denied or withdrew it, and when (F6.4, F6.8). */
  @Column({ name: 'resolved_by', type: 'text', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({
    name: 'denial_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  denialReason: string | null;

  /** For an approved Create request: the supplier it created. */
  @Column({ name: 'created_supplier_id', type: 'uuid', nullable: true })
  createdSupplierId: string | null;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_supplier_id',
    foreignKeyConstraintName: 'FK_supplier_requests_created_supplier',
  })
  createdSupplier?: Supplier;
}
