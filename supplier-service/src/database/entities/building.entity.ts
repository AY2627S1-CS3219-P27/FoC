import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A campus building from the controlled list (F4.1). Buildings are retired,
 * never deleted, so suppliers that already reference one keep working (F1.8).
 */
@Entity({ name: 'buildings' })
@Check('CHK_buildings_canonical_name', `length(btrim(canonical_name)) > 0`)
@Check('CHK_buildings_short_name', `length(btrim(short_name)) > 0`)
@Check('CHK_buildings_latitude', `latitude BETWEEN -90 AND 90`)
@Check('CHK_buildings_longitude', `longitude BETWEEN -180 AND 180`)
export class Building {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_buildings' })
  id: string;

  /** e.g. "Computing 2" */
  @Column({ name: 'canonical_name', type: 'varchar', length: 100 })
  canonicalName: string;

  /** e.g. "COM2"; used in display names (F1.4) */
  @Column({ name: 'short_name', type: 'varchar', length: 20 })
  shortName: string;

  /** Other accepted spellings, e.g. ["Com 2"] */
  @Column({ type: 'text', array: true })
  aliases: string[];

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  /** Null while the building is in use. */
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
