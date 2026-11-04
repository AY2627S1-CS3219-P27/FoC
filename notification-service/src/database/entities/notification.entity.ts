import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Delivery state of one (notification, subscription) pair. */
export enum NotificationStatus {
  Pending = 'pending',
  Delivered = 'delivered',
  Failed = 'failed',
}

/** What the service worker renders (the NS2 payload, once delivery lands). */
export interface NotificationContent {
  title: string;
  body: string;
}

/**
 * One delivery job: a logical notification (`guid`) for one subscription
 * (endpoint). The pair is unique, so fan-out is idempotent and each endpoint
 * can receive a given notification at most once.
 *
 * `attemptCount` is the authority for the RetryNotify guard (NS3.1.2): a
 * retried copy is only delivered when its attempt header matches this value,
 * which drops stale duplicates left by redeliveries.
 */
@Entity({ name: 'notifications' })
@Index('UQ_notifications_guid_subscription_id', ['guid', 'subscriptionId'], {
  unique: true,
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable identity of the logical notification, shared across its fan-out. */
  @Column({ name: 'guid', type: 'uuid' })
  guid: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  /** 1-based; advanced only after the next retry copy is durably published. */
  @Column({ name: 'attempt_count', type: 'integer', default: 1 })
  attemptCount: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.Pending,
  })
  status: NotificationStatus;

  @Column({ name: 'content', type: 'jsonb' })
  content: NotificationContent;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
