import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InboxEvent } from './inbox-event.entity.js';
import { Subscription } from './subscription.entity.js';

/**
 * Delivery lifecycle for one `(event, subscription)` pair.
 *
 * Web Push has no server-side idempotency: retrying a send after a broker
 * redelivery would show the same notification twice. One row per pair makes
 * "has this already been pushed?" a durable lookup instead of an inference.
 */
export enum NotificationDeliveryStatus {
  Pending = 'pending',
  Sent = 'sent',
  Abandoned = 'abandoned',
}

@Entity({ name: 'notification_deliveries' })
@Unique('UQ_notification_deliveries_event_subscription', [
  'eventId',
  'subscriptionId',
])
@Index('IDX_notification_deliveries_event_status', ['eventId', 'status'])
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @ManyToOne(() => InboxEvent, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'event_id',
    foreignKeyConstraintName: 'FK_notification_deliveries_event',
  })
  event: InboxEvent;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'subscription_id',
    foreignKeyConstraintName: 'FK_notification_deliveries_subscription',
  })
  subscription: Subscription;

  /** Denormalized recipient, so fan-out does not need a second join. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: NotificationDeliveryStatus,
    default: NotificationDeliveryStatus.Pending,
  })
  status: NotificationDeliveryStatus;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
