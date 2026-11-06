import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChatCommandError } from './chat-command.error.js';
import type {
  CommittedMessageDto,
  MessageSendCommand,
  MessageSendResult,
} from './message-command.types.js';

interface LockedChatRow {
  chat_id: string;
  requester_user_id: string;
  courier_user_id: string;
  state: 'ACTIVE' | 'GRACE' | 'ARCHIVED';
  writable: boolean;
  next_sequence: string;
}

interface MessageRow {
  message_id: string;
  sequence: string;
  sender_id: string;
  content: string;
  committed_at: Date | string;
  read_at: Date | string | null;
}

@Injectable()
export class MessageCommandService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async send(command: MessageSendCommand): Promise<MessageSendResult> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const chats = await manager.query<LockedChatRow[]>(
        `SELECT c.id AS chat_id,
                c.requester_user_id,
                c.courier_user_id,
                c.state,
                (
                  c.state = 'ACTIVE'
                  OR (c.state = 'GRACE' AND now() < c.closes_at)
                ) AS writable,
                c.next_sequence::text AS next_sequence
           FROM chats c
          WHERE c.id = $1::uuid
            AND (
              c.requester_user_id = $2::uuid
              OR c.courier_user_id = $2::uuid
            )
          FOR UPDATE`,
        [command.chatId, command.senderUserId],
      );
      const chat = chats[0];
      if (!chat) throw new ChatCommandError('NOT_FOUND');
      if (!chat.writable) throw new ChatCommandError('CHAT_ARCHIVED');

      const recipientUserId =
        chat.requester_user_id === command.senderUserId
          ? chat.courier_user_id
          : chat.requester_user_id;
      const existing = await manager.query<MessageRow[]>(
        `SELECT m.id AS message_id,
                m.sequence::text AS sequence,
                m.sender_id,
                m.content,
                m.committed_at,
                m.read_at
           FROM messages m
          WHERE m.chat_id = $1::uuid
            AND m.sender_id = $2::uuid
            AND m.client_message_id = $3::uuid`,
        [command.chatId, command.senderUserId, command.clientMessageId],
      );
      const stored = existing[0];
      if (stored) {
        if (stored.content !== command.content) {
          throw new ChatCommandError('CONFLICT');
        }
        return {
          message: messageDto(stored),
          recipientUserId,
          inserted: false,
        };
      }

      const sequence = safeSequence(chat.next_sequence);
      await manager.query(
        `UPDATE chats
            SET next_sequence = next_sequence + 1,
                updated_at = now()
          WHERE id = $1::uuid`,
        [command.chatId],
      );
      const inserted = await manager.query<MessageRow[]>(
        `INSERT INTO messages
           (id, chat_id, sequence, sender_id, client_message_id, content)
         VALUES ($1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::uuid, $6)
         RETURNING id AS message_id,
                   sequence::text AS sequence,
                   sender_id,
                   content,
                   committed_at,
                   read_at`,
        [
          randomUUID(),
          command.chatId,
          sequence,
          command.senderUserId,
          command.clientMessageId,
          command.content,
        ],
      );
      const message = inserted[0];
      if (!message) throw new Error('Message insert returned no committed row');
      return {
        message: messageDto(message),
        recipientUserId,
        inserted: true,
      };
    });
  }
}

function messageDto(row: MessageRow): CommittedMessageDto {
  return {
    messageId: row.message_id,
    sequence: safeSequence(row.sequence),
    senderUserId: row.sender_id,
    content: row.content,
    timestamp:
      row.committed_at instanceof Date
        ? row.committed_at.toISOString()
        : new Date(row.committed_at).toISOString(),
    status: row.read_at === null ? 'UNREAD' : 'READ',
  };
}

function safeSequence(value: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Message sequence exceeds the supported protocol range');
  }
  return sequence;
}
