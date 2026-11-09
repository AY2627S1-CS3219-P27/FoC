import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ChatArchiveSnapshot } from '../database/entities/index.js';
import type { ArchivedNotification } from '../socket/chat-realtime.publisher.js';
import type { ArchiveClaim } from './archive-claim.service.js';

interface LockedChatRow {
  chat_id: string;
  errand_id: string;
  requester_user_id: string;
  courier_user_id: string;
  state: 'ACTIVE' | 'GRACE' | 'ARCHIVED';
  closes_at: Date | string | null;
  archive_id: string | null;
  archive_claim_expires_at: Date | string;
}

interface MessageSnapshotRow {
  sender_id: string;
  content: string;
  committed_at: Date | string;
}

export type ArchiveResult =
  | { status: 'archived'; notification: ArchivedNotification }
  | { status: 'stale' };

/** Converts one valid claim into its immutable archive in one transaction. */
@Injectable()
export class ArchiveService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  archive(claim: ArchiveClaim): Promise<ArchiveResult> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const chats = await manager.query<LockedChatRow[]>(
        `SELECT chat.id AS chat_id,
                chat.errand_id,
                chat.requester_user_id,
                chat.courier_user_id,
                chat.state,
                chat.closes_at,
                chat.archive_id,
                chat.archive_claim_expires_at
           FROM chats AS chat
          WHERE chat.id = $1::uuid
            AND chat.archive_claim_token = $2::uuid
          FOR UPDATE`,
        [claim.chatId, claim.claimToken],
      );
      const chat = chats[0];
      if (chat === undefined) return { status: 'stale' };

      const clockRows = await manager.query<
        Array<{ archived_at: Date | string }>
      >('SELECT clock_timestamp() AS archived_at');
      const archiveClockValue = clockRows[0]?.archived_at;
      if (archiveClockValue === undefined) {
        throw new Error('Archive clock returned no database timestamp');
      }
      const archivedAt = new Date(archiveClockValue);
      if (
        chat.state !== 'GRACE' ||
        chat.archive_id !== null ||
        chat.closes_at === null ||
        new Date(chat.closes_at).getTime() > archivedAt.getTime() ||
        new Date(chat.archive_claim_expires_at).getTime() <=
          archivedAt.getTime()
      ) {
        return { status: 'stale' };
      }

      const messages = await manager.query<MessageSnapshotRow[]>(
        `SELECT message.sender_id,
                message.content,
                message.committed_at
           FROM messages AS message
          WHERE message.chat_id = $1::uuid
          ORDER BY message.sequence ASC`,
        [chat.chat_id],
      );
      const snapshot = buildArchiveSnapshot(chat, archivedAt, messages);
      const archiveId = randomUUID();

      await manager.query(
        `INSERT INTO chat_archives
           (id, chat_id, errand_id, requester_user_id, courier_user_id,
            archived_at, schema_version, snapshot)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                 $6::timestamptz, 1, $7::jsonb)`,
        [
          archiveId,
          chat.chat_id,
          chat.errand_id,
          chat.requester_user_id,
          chat.courier_user_id,
          archivedAt,
          JSON.stringify(snapshot),
        ],
      );
      await manager.query('DELETE FROM messages WHERE chat_id = $1::uuid', [
        chat.chat_id,
      ]);
      await manager.query(
        `UPDATE chats
            SET state = 'ARCHIVED',
                archive_id = $3::uuid,
                archive_claim_token = NULL,
                archive_claim_expires_at = NULL,
                updated_at = $4::timestamptz
          WHERE id = $1::uuid
            AND archive_claim_token = $2::uuid`,
        [chat.chat_id, claim.claimToken, archiveId, archivedAt],
      );

      return {
        status: 'archived',
        notification: {
          chatId: chat.chat_id,
          archiveId,
          requesterUserId: chat.requester_user_id,
          courierUserId: chat.courier_user_id,
          archivedAt,
        },
      };
    });
  }
}

export function buildArchiveSnapshot(
  chat: Pick<
    LockedChatRow,
    'chat_id' | 'errand_id' | 'requester_user_id' | 'courier_user_id'
  >,
  archivedAt: Date,
  messages: MessageSnapshotRow[],
): ChatArchiveSnapshot {
  if (Number.isNaN(archivedAt.getTime())) {
    throw new Error('Archive timestamp is invalid');
  }
  return {
    schemaVersion: 1,
    chatId: chat.chat_id,
    errandId: chat.errand_id,
    requesterUserId: chat.requester_user_id,
    courierUserId: chat.courier_user_id,
    archivedAt: archivedAt.toISOString(),
    messages: messages.map((message) => ({
      role:
        message.sender_id === chat.requester_user_id
          ? 'REQUESTER'
          : message.sender_id === chat.courier_user_id
            ? 'COURIER'
            : invalidMessageSender(),
      content: message.content,
      timestamp: toIso(message.committed_at),
    })),
  };
}

function invalidMessageSender(): never {
  throw new Error('Archived message sender is not a chat participant');
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Archived message timestamp is invalid');
  }
  return date.toISOString();
}
