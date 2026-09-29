import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '@foc/contracts';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
  uuid: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255 })
  displayName: string;

  @Column({ type: 'varchar', length: 2083, nullable: true })
  profilePictureUrl: string | null;

  @Column({ length: 128 })
  passwordHash: string;

  @Column({ length: 32 })
  passwordSalt: string;

  @Column({ default: false })
  isAdmin: boolean;

  @Column({ default: false })
  isLocked: boolean;

  @Column({ default: false })
  isArchived: boolean;

  /** Participant roles */
  @Column({
    type: 'enum',
    enum: Role,
    array: true,
    default: '{}',
  })
  roles: Role[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
