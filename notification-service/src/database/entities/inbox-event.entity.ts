import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

/**
 * Durable evidence that a domain event reached this service.
 *
 * `event_id` is the deduplication identity: the broker delivers at least once,
 * so a redelivery of the same envelope must be acknowledged without fanning
 * out a second push. The payload hash distinguishes a benign redelivery from a
 * publisher reusing an event id for different evidence.
 */
@Entity({ name: 'inbox_events' })
@Check(
  'CHK_inbox_events_identity',
  `char_length(btrim(event_type)) > 0
   AND char_length(btrim(routing_key)) > 0
   AND char_length(btrim(publisher)) > 0`,
)
@Check('CHK_inbox_events_payload_hash', `payload_hash ~ '^[0-9a-f]{64}$'`)
export class InboxEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType: string;

  @Column({ name: 'routing_key', type: 'text' })
  routingKey: string;

  @Column({ name: 'publisher', type: 'text' })
  publisher: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;
}
