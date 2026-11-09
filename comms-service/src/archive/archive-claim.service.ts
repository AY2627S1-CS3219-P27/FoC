import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.js';

export interface ArchiveClaim {
  chatId: string;
  claimToken: string;
  reclaimed: boolean;
}

interface DueChatRow {
  chat_id: string;
  reclaimed: boolean;
}

interface ClaimClockRow {
  claimed_at: Date | string;
}

/** Claims bounded due work without making replicas wait on each other. */
@Injectable()
export class ArchiveClaimService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  claimDueBatch(): Promise<ArchiveClaim[]> {
    const batchSize = this.config.get('ARCHIVE_BATCH_SIZE', { infer: true });
    const claimTtlMs = this.config.get('ARCHIVE_CLAIM_TTL_MS', {
      infer: true,
    });

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const due = await manager.query<DueChatRow[]>(
        `SELECT chat.id AS chat_id,
                (chat.archive_claim_token IS NOT NULL) AS reclaimed
           FROM chats AS chat
          WHERE chat.state = 'GRACE'
            AND chat.archive_id IS NULL
            AND chat.closes_at <= clock_timestamp()
            AND (
              chat.archive_claim_token IS NULL
              OR chat.archive_claim_expires_at <= clock_timestamp()
            )
          ORDER BY chat.closes_at ASC, chat.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [batchSize],
      );
      if (due.length === 0) return [];

      const clockRows = await manager.query<ClaimClockRow[]>(
        'SELECT clock_timestamp() AS claimed_at',
      );
      const claimClock = clockRows[0]?.claimed_at;
      if (claimClock === undefined) {
        throw new Error('Archive claim clock returned no database timestamp');
      }

      const claims: ArchiveClaim[] = [];
      for (const row of due) {
        const claimToken = randomUUID();
        await manager.query(
          `UPDATE chats
              SET archive_claim_token = $2::uuid,
                  archive_claim_expires_at =
                    $3::timestamptz + $4::bigint * interval '1 millisecond'
            WHERE id = $1::uuid
              AND state = 'GRACE'
              AND archive_id IS NULL`,
          [row.chat_id, claimToken, claimClock, claimTtlMs],
        );
        claims.push({
          chatId: row.chat_id,
          claimToken,
          reclaimed: row.reclaimed,
        });
      }
      return claims;
    });
  }
}
