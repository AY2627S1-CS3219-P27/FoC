import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChatCommandError } from './chat-command.error.js';
import type {
  MessagesReadCommand,
  MessagesReadResult,
} from './read-command.types.js';

interface LockedChatRow {
  requester_user_id: string;
  courier_user_id: string;
  state: 'ACTIVE' | 'GRACE' | 'ARCHIVED';
  writable: boolean;
  latest_sequence: string;
}

interface ReadUpdateRow {
  highest_read_sequence: string | null;
  read_at: Date | string | null;
}

@Injectable()
export class ReadCommandService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async markRead(command: MessagesReadCommand): Promise<MessagesReadResult> {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const chats = await manager.query<LockedChatRow[]>(
        `WITH locked AS MATERIALIZED (
           SELECT c.requester_user_id,
                  c.courier_user_id,
                  c.next_sequence,
                  c.state,
                  c.closes_at
             FROM chats c
            WHERE c.id = $1::uuid
              AND (
                c.requester_user_id = $2::uuid
                OR c.courier_user_id = $2::uuid
              )
            FOR UPDATE
         )
         SELECT requester_user_id,
                courier_user_id,
                (next_sequence - 1)::text AS latest_sequence,
                state,
                (
                  state = 'ACTIVE'
                  OR (
                    state = 'GRACE'
                    AND clock_timestamp() < closes_at
                  )
                ) AS writable
           FROM locked`,
        [command.chatId, command.readerUserId],
      );
      const chat = chats[0];
      if (!chat) throw new ChatCommandError('NOT_FOUND');
      if (!chat.writable) {
        throw new ChatCommandError('CHAT_ARCHIVED');
      }

      const latestSequence = safeNonNegativeSequence(chat.latest_sequence);
      if (command.throughSequence > latestSequence) {
        throw new ChatCommandError('CONFLICT');
      }
      const affectedSenderUserId =
        chat.requester_user_id === command.readerUserId
          ? chat.courier_user_id
          : chat.requester_user_id;

      const updates = await manager.query<ReadUpdateRow[]>(
        `WITH read_clock AS MATERIALIZED (
           SELECT statement_timestamp() AS read_at
         ), updated AS (
           UPDATE messages message
              SET read_at = read_clock.read_at
             FROM read_clock
            WHERE message.chat_id = $1::uuid
              AND message.sender_id = $2::uuid
              AND message.sequence <= $3::bigint
              AND message.read_at IS NULL
           RETURNING message.sequence, message.read_at
         )
         SELECT max(sequence)::text AS highest_read_sequence,
                min(read_at) AS read_at
           FROM updated`,
        [command.chatId, affectedSenderUserId, command.throughSequence],
      );
      const update = updates[0];
      if (!update || update.highest_read_sequence === null) {
        return {
          data: {
            chatId: command.chatId,
            throughSequence: command.throughSequence,
            highestReadSequence: null,
            readAt: null,
          },
          affectedSenderUserId,
          changed: false,
        };
      }
      if (update.read_at === null) {
        throw new Error('Read update returned no database timestamp');
      }

      return {
        data: {
          chatId: command.chatId,
          throughSequence: command.throughSequence,
          highestReadSequence: safePositiveSequence(
            update.highest_read_sequence,
          ),
          readAt: iso(update.read_at),
        },
        affectedSenderUserId,
        changed: true,
      };
    });
  }
}

function safeNonNegativeSequence(value: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('Chat sequence exceeds the supported protocol range');
  }
  return sequence;
}

function safePositiveSequence(value: string): number {
  const sequence = safeNonNegativeSequence(value);
  if (sequence < 1) {
    throw new Error('Message sequence must be positive');
  }
  return sequence;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
