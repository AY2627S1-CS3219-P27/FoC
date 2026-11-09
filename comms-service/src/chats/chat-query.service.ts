import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ChatCursorCodec,
  type MessageHistoryDirection,
} from './chat-cursor.codec.js';
import type {
  ArchiveDetailDto,
  ArchiveListItemDto,
  ArchiveListResponseDto,
  ChatListResponseDto,
  ChatViewDto,
  MessageHistoryResponseDto,
  MessageViewDto,
} from './chats.dto.js';
import type { ChatArchiveSnapshot } from '../database/entities/chat-archive.entity.js';

interface ChatRow {
  chat_id: string;
  errand_id: string;
  requester_user_id: string;
  courier_user_id: string;
  state: 'ACTIVE' | 'GRACE';
  closes_at: Date | string | null;
  close_reason: ChatViewDto['closeReason'];
  updated_at: Date | string;
  cursor_updated_at: string;
  message_id: string | null;
  sequence: string | null;
  sender_id: string | null;
  content: string | null;
  committed_at: Date | string | null;
  read_at: Date | string | null;
  unread: boolean;
}

interface MessageRow {
  authorized: boolean;
  message_id: string | null;
  sequence: string | null;
  sender_id: string | null;
  content: string | null;
  committed_at: Date | string | null;
  read_at: Date | string | null;
}

interface ArchiveListRow {
  archive_id: string;
  chat_id: string;
  errand_id: string;
  requester_user_id: string;
  courier_user_id: string;
  archived_at: Date | string;
  cursor_archived_at: string;
}

interface ArchiveDetailRow extends ArchiveListRow {
  schema_version: number;
  snapshot: unknown;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function sequenceNumber(value: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Message sequence exceeds the supported API range');
  }
  return sequence;
}

function messageView(row: {
  message_id: string;
  sequence: string;
  sender_id: string;
  content: string;
  committed_at: Date | string;
  read_at: Date | string | null;
}): MessageViewDto {
  return {
    messageId: row.message_id,
    sequence: sequenceNumber(row.sequence),
    senderUserId: row.sender_id,
    content: row.content,
    timestamp: iso(row.committed_at),
    status: row.read_at === null ? 'UNREAD' : 'READ',
  };
}

function archiveNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'ARCHIVE_NOT_FOUND',
    message: 'Archive not found',
  });
}

function archiveListItem(row: ArchiveListRow): ArchiveListItemDto {
  return {
    archiveId: row.archive_id,
    chatId: row.chat_id,
    errandId: row.errand_id,
    requesterUserId: row.requester_user_id,
    courierUserId: row.courier_user_id,
    archivedAt: iso(row.archived_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, i) => key === keys[i])
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validatedSnapshot(row: ArchiveDetailRow): ChatArchiveSnapshot {
  const snapshot = row.snapshot;
  const expectedArchivedAt = iso(row.archived_at);
  const keys = [
    'archivedAt',
    'chatId',
    'courierUserId',
    'errandId',
    'messages',
    'requesterUserId',
    'schemaVersion',
  ];
  if (
    row.schema_version !== 1 ||
    !isRecord(snapshot) ||
    !hasExactKeys(snapshot, keys) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.chatId !== row.chat_id ||
    snapshot.errandId !== row.errand_id ||
    snapshot.requesterUserId !== row.requester_user_id ||
    snapshot.courierUserId !== row.courier_user_id ||
    snapshot.archivedAt !== expectedArchivedAt ||
    !Array.isArray(snapshot.messages)
  ) {
    throw new Error('Stored archive snapshot failed integrity validation');
  }

  for (const message of snapshot.messages) {
    if (
      !isRecord(message) ||
      !hasExactKeys(message, ['content', 'role', 'timestamp']) ||
      (message.role !== 'REQUESTER' && message.role !== 'COURIER') ||
      typeof message.content !== 'string' ||
      !isCanonicalTimestamp(message.timestamp)
    ) {
      throw new Error('Stored archive snapshot failed integrity validation');
    }
  }
  return snapshot as unknown as ChatArchiveSnapshot;
}

@Injectable()
export class ChatQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cursors: ChatCursorCodec,
  ) {}

  async list(
    callerId: string,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<ChatListResponseDto> {
    const cursor = cursorValue
      ? this.cursors.decodeChat(cursorValue)
      : undefined;
    const rows = await this.dataSource.query<ChatRow[]>(
      `SELECT c.id AS chat_id,
              c.errand_id,
              c.requester_user_id,
              c.courier_user_id,
              c.state,
              c.closes_at,
              c.close_reason,
              c.updated_at,
              to_char(
                c.updated_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_updated_at,
              latest.id AS message_id,
              latest.sequence::text AS sequence,
              latest.sender_id,
              latest.content,
              latest.committed_at,
              latest.read_at,
              EXISTS (
                SELECT 1 FROM messages unread_message
                WHERE unread_message.chat_id = c.id
                  AND unread_message.sender_id <> $1::uuid
                  AND unread_message.read_at IS NULL
              ) AS unread
         FROM chats c
         LEFT JOIN LATERAL (
           SELECT m.id, m.sequence, m.sender_id, m.content,
                  m.committed_at, m.read_at
             FROM messages m
            WHERE m.chat_id = c.id
            ORDER BY m.sequence DESC
            LIMIT 1
         ) latest ON true
        WHERE (c.requester_user_id = $1::uuid OR c.courier_user_id = $1::uuid)
          AND c.state IN ('ACTIVE', 'GRACE')
          AND ($2::timestamptz IS NULL OR (c.updated_at, c.id) < ($2::timestamptz, $3::uuid))
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $4`,
      [callerId, cursor?.updatedAt ?? null, cursor?.chatId ?? null, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map((row): ChatViewDto => ({
      chatId: row.chat_id,
      errandId: row.errand_id,
      requesterUserId: row.requester_user_id,
      courierUserId: row.courier_user_id,
      state: row.state,
      closesAt: row.closes_at === null ? null : iso(row.closes_at),
      closeReason: row.close_reason,
      updatedAt: iso(row.updated_at),
      lastMessage:
        row.message_id === null
          ? null
          : messageView({
              message_id: row.message_id,
              sequence: row.sequence!,
              sender_id: row.sender_id!,
              content: row.content!,
              committed_at: row.committed_at!,
              read_at: row.read_at,
            }),
      unread: row.unread,
    }));
    const last = page.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encodeChat(last.cursor_updated_at, last.chat_id)
          : null,
    };
  }

  async history(
    callerId: string,
    chatId: string,
    cursorValue: string | undefined,
    limit: number,
    direction: MessageHistoryDirection = 'forward',
  ): Promise<MessageHistoryResponseDto> {
    const boundarySequence = cursorValue
      ? this.cursors.decodeMessages(cursorValue, direction)
      : direction === 'forward'
        ? 0
        : null;
    const comparison = direction === 'forward' ? '>' : '<';
    const pageOrder = direction === 'forward' ? 'ASC' : 'DESC';
    const rows = await this.dataSource.query<MessageRow[]>(
      `WITH authorized_chat AS (
         SELECT c.id
           FROM chats c
          WHERE c.id = $1::uuid
            AND c.state IN ('ACTIVE', 'GRACE')
            AND (c.requester_user_id = $2::uuid OR c.courier_user_id = $2::uuid)
       )
       SELECT true AS authorized,
              page.id AS message_id,
              page.sequence::text AS sequence,
              page.sender_id,
              page.content,
              page.committed_at,
              page.read_at
         FROM authorized_chat chat
         LEFT JOIN LATERAL (
           SELECT m.id, m.sequence, m.sender_id, m.content,
                  m.committed_at, m.read_at
             FROM messages m
            WHERE m.chat_id = chat.id
              AND ($3::bigint IS NULL OR m.sequence ${comparison} $3::bigint)
            ORDER BY m.sequence ${pageOrder}
            LIMIT $4
         ) page ON true
        ORDER BY page.sequence ASC NULLS LAST`,
      [chatId, callerId, boundarySequence, limit + 1],
    );

    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: 'Chat not found',
      });
    }

    const messageRows = rows.filter(
      (
        row,
      ): row is MessageRow & {
        message_id: string;
        sequence: string;
        sender_id: string;
        content: string;
        committed_at: Date | string;
      } => row.message_id !== null,
    );
    const hasMore = messageRows.length > limit;
    const page =
      direction === 'backward' && hasMore
        ? messageRows.slice(1)
        : messageRows.slice(0, limit);
    const items = page.map(messageView);
    const cursorSequence =
      direction === 'backward' ? items.at(0)?.sequence : items.at(-1)?.sequence;
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && cursorSequence !== undefined
          ? this.cursors.encodeMessages(cursorSequence, direction)
          : null,
    };
  }

  async listArchives(
    callerId: string,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<ArchiveListResponseDto> {
    const cursor = cursorValue
      ? this.cursors.decodeArchive(cursorValue)
      : undefined;
    const rows = await this.dataSource.query<ArchiveListRow[]>(
      `SELECT archive.id AS archive_id,
              archive.chat_id,
              archive.errand_id,
              archive.requester_user_id,
              archive.courier_user_id,
              archive.archived_at,
              to_char(
                archive.archived_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_archived_at
         FROM chat_archives archive
        WHERE (archive.requester_user_id = $1::uuid
               OR archive.courier_user_id = $1::uuid)
          AND ($2::timestamptz IS NULL
               OR (archive.archived_at, archive.id) < ($2::timestamptz, $3::uuid))
        ORDER BY archive.archived_at DESC, archive.id DESC
        LIMIT $4`,
      [
        callerId,
        cursor?.archivedAt ?? null,
        cursor?.archiveId ?? null,
        limit + 1,
      ],
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(archiveListItem),
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encodeArchive(last.cursor_archived_at, last.archive_id)
          : null,
    };
  }

  async archiveDetail(
    callerId: string,
    archiveId: string,
  ): Promise<ArchiveDetailDto> {
    const rows = await this.dataSource.query<ArchiveDetailRow[]>(
      `SELECT archive.id AS archive_id,
              archive.chat_id,
              archive.errand_id,
              archive.requester_user_id,
              archive.courier_user_id,
              archive.archived_at,
              to_char(
                archive.archived_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) AS cursor_archived_at,
              archive.schema_version,
              archive.snapshot
         FROM chat_archives archive
        WHERE archive.id = $1::uuid
          AND (archive.requester_user_id = $2::uuid
               OR archive.courier_user_id = $2::uuid)`,
      [archiveId, callerId],
    );
    const row = rows[0];
    if (!row) throw archiveNotFound();

    const snapshot = validatedSnapshot(row);
    const metadata = archiveListItem(row);
    return {
      archiveId: metadata.archiveId,
      chatId: metadata.chatId,
      errandId: metadata.errandId,
      requesterUserId: metadata.requesterUserId,
      courierUserId: metadata.courierUserId,
      archivedAt: metadata.archivedAt,
      schemaVersion: snapshot.schemaVersion,
      messages: snapshot.messages.map(({ role, content, timestamp }) => ({
        role,
        content,
        timestamp,
      })),
    };
  }
}
