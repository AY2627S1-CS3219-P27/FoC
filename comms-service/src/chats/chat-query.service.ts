import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChatCursorCodec } from './chat-cursor.codec.js';
import type {
  ChatListResponseDto,
  ChatViewDto,
  MessageHistoryResponseDto,
  MessageViewDto,
} from './chats.dto.js';

interface ChatRow {
  chat_id: string;
  errand_id: string;
  requester_user_id: string;
  courier_user_id: string;
  state: 'ACTIVE' | 'GRACE';
  closes_at: Date | string | null;
  close_reason: ChatViewDto['closeReason'];
  updated_at: Date | string;
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
      [
        callerId,
        cursor?.updatedAt.toISOString() ?? null,
        cursor?.chatId ?? null,
        limit + 1,
      ],
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
          ? this.cursors.encodeChat(new Date(last.updated_at), last.chat_id)
          : null,
    };
  }

  async history(
    callerId: string,
    chatId: string,
    cursorValue: string | undefined,
    limit: number,
  ): Promise<MessageHistoryResponseDto> {
    const afterSequence = cursorValue
      ? this.cursors.decodeMessages(cursorValue)
      : 0;
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
            WHERE m.chat_id = chat.id AND m.sequence > $3::bigint
            ORDER BY m.sequence ASC
            LIMIT $4
         ) page ON true
        ORDER BY page.sequence ASC NULLS LAST`,
      [chatId, callerId, afterSequence, limit + 1],
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
    const page = messageRows.slice(0, limit);
    const items = page.map(messageView);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && items.length > 0
          ? this.cursors.encodeMessages(items.at(-1)!.sequence)
          : null,
    };
  }
}
