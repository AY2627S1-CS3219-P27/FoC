import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Chat,
  ChatLifecycleEvent,
  InboxEvent,
} from '../database/entities/index.js';
import { hashCanonicalJson } from './canonical-json.js';
import {
  type LifecycleEvent,
  normalizeLifecycleEvent,
} from './lifecycle-event.js';

export type LifecycleIngestionOutcome =
  | {
      status: 'recorded';
      eventId: string;
      chatId?: string;
    }
  | { status: 'duplicate'; eventId: string }
  | { status: 'event-id-conflict'; eventId: string };

/** Commits inbox identity, immutable evidence, and optional chat atomically. */
@Injectable()
export class LifecycleIngestionService {
  constructor(private readonly dataSource: DataSource) {}

  async process(
    event: LifecycleEvent,
    routingKey: string,
  ): Promise<LifecycleIngestionOutcome> {
    const evidenceHash = hashCanonicalJson(event);
    const normalized = normalizeLifecycleEvent(event);

    return this.dataSource.transaction(async (manager) => {
      // A row lock cannot protect an event ID that has not been inserted yet.
      // This transaction-scoped advisory lock serializes only that identity and
      // is automatically released on commit or rollback.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [event.eventId],
      );

      const inbox = manager.getRepository(InboxEvent);
      const existing = await inbox.findOneBy({ eventId: event.eventId });
      if (existing) {
        if (
          existing.eventType === event.eventType &&
          existing.routingKey === routingKey &&
          existing.publisher === event.publisher &&
          existing.payloadHash === evidenceHash
        ) {
          return { status: 'duplicate', eventId: event.eventId };
        }
        return { status: 'event-id-conflict', eventId: event.eventId };
      }

      await inbox.save(
        inbox.create({
          eventId: event.eventId,
          eventType: event.eventType,
          routingKey,
          publisher: event.publisher,
          payloadHash: evidenceHash,
        }),
      );

      const lifecycle = manager.getRepository(ChatLifecycleEvent);
      await lifecycle.save(
        lifecycle.create({
          sourceEventId: event.eventId,
          kind: normalized.kind,
          errandId: normalized.errandId,
          requesterUserId: normalized.requesterUserId,
          courierUserId: normalized.courierUserId,
          occurredAt: normalized.occurredAt,
          derivedCloseAt: normalized.derivedCloseAt,
          envelope: normalized.envelope,
          payload: normalized.payload,
        }),
      );

      if (normalized.kind !== 'ERRAND_ACCEPTED') {
        return { status: 'recorded', eventId: event.eventId };
      }

      const chatId = randomUUID();
      const chats = manager.getRepository(Chat);
      await chats.save(
        chats.create({
          id: chatId,
          acceptanceEventId: event.eventId,
          errandId: normalized.errandId,
          requesterUserId: normalized.requesterUserId!,
          courierUserId: normalized.courierUserId!,
          acceptedAt: normalized.occurredAt,
          state: 'ACTIVE',
          closesAt: null,
          closeReason: null,
          nextSequence: '1',
          archiveId: null,
          archiveClaimToken: null,
          archiveClaimExpiresAt: null,
        }),
      );
      return { status: 'recorded', eventId: event.eventId, chatId };
    });
  }
}
