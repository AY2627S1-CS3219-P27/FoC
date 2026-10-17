import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  BeforeInsert,
} from 'typeorm';
import { User } from '../users/user.entity.js';
import { REFRESH_TOKEN_EXPIRATION_IN_SECONDS } from '../common/constants.js';

@Entity('refresh-token')
export class RefreshToken {
  @PrimaryColumn({ type: 'text' })
  hashedToken: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  issuedAt: Date;

  @BeforeInsert()
  calculateEndDate() {
    const date = new Date();
    date.setSeconds(date.getSeconds() + REFRESH_TOKEN_EXPIRATION_IN_SECONDS);
    this.expiresAt = date;
  }
}
