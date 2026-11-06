import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChatSocketError, type ChatJoinData } from './chat-socket.protocol.js';

interface ChatAdmissionRow {
  chat_id: string;
  state: 'ACTIVE' | 'GRACE';
  closes_at: Date | string | null;
  close_reason: ChatJoinData['closeReason'];
  next_sequence: string;
}

@Injectable()
export class ChatAdmissionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async authorize(userId: string, chatId: string): Promise<ChatJoinData> {
    const rows = await this.dataSource.query<ChatAdmissionRow[]>(
      `SELECT c.id AS chat_id,
              c.state,
              c.closes_at,
              c.close_reason,
              c.next_sequence::text AS next_sequence
         FROM chats c
        WHERE c.id = $1::uuid
          AND c.state IN ('ACTIVE', 'GRACE')
          AND (c.requester_user_id = $2::uuid OR c.courier_user_id = $2::uuid)`,
      [chatId, userId],
    );
    const row = rows[0];
    if (!row) throw new ChatSocketError('NOT_FOUND');

    const nextSequence = Number(row.next_sequence);
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1) {
      throw new Error('Chat sequence exceeds the supported protocol range');
    }

    return {
      chatId: row.chat_id,
      state: row.state,
      closesAt:
        row.closes_at === null ? null : new Date(row.closes_at).toISOString(),
      closeReason: row.close_reason,
      latestSequence: nextSequence - 1,
    };
  }
}
