import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Delivery channels a subscription can use. Web Push is the only one today;
 * the discriminator column keeps the table open to future channels (e.g.
 * direct-to-Android) without reshaping existing rows.
 */
export enum SubscriptionChannel {
  WebPush = 'web_push',
}

export enum SubscriptionStatus {
  Active = 'active',
  Inactive = 'inactive',
}

/**
 * Web Push encryption material taken verbatim from the browser's
 * `PushSubscription.keys`. Kept channel-scoped: a future channel stores its
 * own shape in the same `credentials` column.
 */
export interface WebPushCredentials {
  p256dh: string;
  auth: string;
}

/**
 * One push destination registered by one user.
 *
 * `(user_id, endpoint)` is the natural key the API exposes and the unique
 * constraint enforces: re-registering the same endpoint updates/reactivates
 * this row instead of growing duplicates. Deletion is a soft delete — the row
 * stays with `status = inactive` and `deactivated_at` set.
 */
@Entity({ name: 'subscriptions' })
@Index('UQ_subscriptions_user_id_endpoint', ['userId', 'endpoint'], {
  unique: true,
})
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The user's uuid identity, taken from the verified access token (`sub`). */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'channel', type: 'enum', enum: SubscriptionChannel })
  channel: SubscriptionChannel;

  /**
   * The channel's natural address: the Web Push endpoint URL for `web_push`,
   * a device token for a future Android channel.
   */
  @Column({ name: 'endpoint', type: 'text' })
  endpoint: string;

  @Column({ name: 'credentials', type: 'jsonb' })
  credentials: WebPushCredentials;

  /** Web Push `PushSubscription.expirationTime` (epoch ms), if the browser set one. */
  @Column({ name: 'expiration_time', type: 'timestamptz', nullable: true })
  expirationTime: Date | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.Active,
  })
  status: SubscriptionStatus;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
