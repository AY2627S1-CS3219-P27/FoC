import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Building } from './building.entity.js';

/**
 * A delivery venue: a room inside a building where an order can be handed
 * over. Venues are retired, never deleted, so historical orders still resolve.
 */
@Entity({ name: 'venues' })
@Unique('UQ_venues_building_code', ['buildingId', 'code'])
@Index('IDX_venues_building_id', ['buildingId'])
@Check('CHK_venues_code', `length(btrim(code)) > 0`)
@Check('CHK_venues_name', `name IS NULL OR length(btrim(name)) > 0`)
@Check('CHK_venues_floor', `floor ~ '^(B[1-9]|[1-9][0-9]?|M)$'`)
@Check('CHK_venues_latitude', `latitude BETWEEN -90 AND 90`)
@Check('CHK_venues_longitude', `longitude BETWEEN -180 AND 180`)
export class Venue {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_venues' })
  id: string;

  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  @ManyToOne(() => Building, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'building_id',
    foreignKeyConstraintName: 'FK_venues_building',
  })
  building?: Building;

  /** e.g. "LT19"; unique within the building. */
  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  /** Same format as suppliers: B1-B9, 1-99 or M, stored as "3" not "03". */
  @Column({ type: 'varchar', length: 2 })
  floor: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  /** Null while the venue is in use. */
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
