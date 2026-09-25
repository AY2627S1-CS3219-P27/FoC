import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 255 })
  displayName: string;

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

  @Column({ default: false })
  isAdmin: boolean;

  @Column({ default: false })
  isLocked: boolean;

  @Column({ default: false })
  isArchived: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
