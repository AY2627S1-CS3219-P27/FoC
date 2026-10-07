import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Building } from './building.entity.js';

/**
 * One row per normalised name, short name or alias of each non-retired
 * building (see buildingKey). The primary key makes the database itself
 * reject two in-use buildings sharing any name (F4.2), and resolving a
 * building from any spelling is a single key lookup (F4.5). Rows are removed
 * when a building is retired, so its names become reusable.
 */
@Entity({ name: 'building_name_keys' })
@Index('IDX_building_name_keys_building_id', ['buildingId'])
export class BuildingNameKey {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'PK_building_name_keys',
  })
  key: string;

  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  @ManyToOne(() => Building, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'building_id',
    foreignKeyConstraintName: 'FK_building_name_keys_building',
  })
  building?: Building;
}
