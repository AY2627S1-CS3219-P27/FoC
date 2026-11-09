import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  Chat,
  type ChatCloseReason,
  ChatLifecycleEvent,
  InboxEvent,
} from '../database/entities/index.js';
import { hashCanonicalJson } from './canonical-json.js';
import { LifecycleFactQueryService } from './lifecycle-fact-query.service.js';
import {
  type LifecycleEvent,
  normalizeLifecycleEvent,
} from './lifecycle-event.js';

export interface LifecycleDeadlineTransition {
  chatId: string;
  requesterUserId: string;
  courierUserId: string;
  closesAt: Date;
  closeReason: ChatCloseReason;
}

export type LifecycleIngestionOutcome =
  | {
      status: 'recorded';
      eventId: string;
      chatId?: string;
      deadlineTransitions: LifecycleDeadlineTransition[];
    }
  | { status: 'duplicate'; eventId: string }
  | { status: 'event-id-conflict'; eventId: string };

interface DeadlineTransitionRow {
  chat_id: string;
  requester_user_id: string;
  courier_user_id: string;
  closes_at: Date | string;
  close_reason: ChatCloseReason;
}

/** Commits inbox identity, immutable evidence, and optional chat atomically. */
@Injectable()
export class LifecycleIngestionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lifecycleFacts: LifecycleFactQueryService,
  ) {}

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

      // Different lifecycle event IDs for one errand can be delivered at the
      // same time. Serializing that errand prevents an acceptance and terminal
      // fact from committing without either transaction observing the other.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
        [normalized.errandId],
      );

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
        const deadlineTransitions = await this.applyTerminalDeadline(
          manager,
          normalized.kind,
          normalized.errandId,
          normalized.requesterUserId,
          normalized.courierUserId,
          normalized.occurredAt,
          normalized.derivedCloseAt!,
        );
        return {
          status: 'recorded',
          eventId: event.eventId,
          deadlineTransitions,
        };
      }

      const chatId = randomUUID();
      const chats = manager.getRepository(Chat);
      const applicableFacts =
        await this.lifecycleFacts.findApplicableTerminalFacts(
          {
            errandId: normalized.errandId,
            requesterUserId: normalized.requesterUserId!,
            courierUserId: normalized.courierUserId!,
            acceptedAt: normalized.occurredAt,
          },
          manager,
        );
      const earliestTerminal = applicableFacts[0];
      await chats.save(
        chats.create({
          id: chatId,
          acceptanceEventId: event.eventId,
          errandId: normalized.errandId,
          requesterUserId: normalized.requesterUserId!,
          courierUserId: normalized.courierUserId!,
          acceptedAt: normalized.occurredAt,
          state: earliestTerminal === undefined ? 'ACTIVE' : 'GRACE',
          closesAt: earliestTerminal?.derivedCloseAt ?? null,
          closeReason:
            earliestTerminal === undefined
              ? null
              : (earliestTerminal.kind as ChatCloseReason),
          nextSequence: '1',
          archiveId: null,
          archiveClaimToken: null,
          archiveClaimExpiresAt: null,
        }),
      );
      return {
        status: 'recorded',
        eventId: event.eventId,
        chatId,
        deadlineTransitions: [],
      };
    });
  }

  private async applyTerminalDeadline(
    manager: EntityManager,
    closeReason: ChatCloseReason,
    errandId: string,
    requesterUserId: string | null,
    courierUserId: string | null,
    occurredAt: Date,
    closesAt: Date,
  ): Promise<LifecycleDeadlineTransition[]> {
    const rows = await manager.query<DeadlineTransitionRow[]>(
      `WITH matching AS (
         SELECT chat.id
         FROM chats AS chat
         WHERE chat.errand_id = $1
           AND chat.accepted_at <= $2
           AND chat.state IN ('ACTIVE', 'GRACE')
           AND (
             $3::text = 'ERRAND_CANCELLED'
             OR (
               chat.requester_user_id = $4::uuid
               AND chat.courier_user_id = $5::uuid
             )
           )
         ORDER BY chat.id
         FOR UPDATE
       ), changed AS (
         UPDATE chats AS chat
         SET state = 'GRACE',
             closes_at = $6,
             close_reason = $3,
             updated_at = now()
         FROM matching
         WHERE chat.id = matching.id
           AND (
             chat.state = 'ACTIVE'
             OR (chat.state = 'GRACE' AND $6::timestamptz < chat.closes_at)
           )
         RETURNING
           chat.id AS chat_id,
           chat.requester_user_id,
           chat.courier_user_id,
           chat.closes_at,
           chat.close_reason
       )
       SELECT * FROM changed ORDER BY chat_id`,
      [
        errandId,
        occurredAt,
        closeReason,
        requesterUserId,
        courierUserId,
        closesAt,
      ],
    );

    return rows.map((row) => ({
      chatId: row.chat_id,
      requesterUserId: row.requester_user_id,
      courierUserId: row.courier_user_id,
      closesAt: new Date(row.closes_at),
      closeReason: row.close_reason,
    }));
  }
}
