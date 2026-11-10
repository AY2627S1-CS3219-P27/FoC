import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatLog } from '../database/entities/index.js';

export type Reservation =
  { allowed: true; id: string } | { allowed: false; retryAfterSeconds: number };

export type ChatLogResult = Pick<
  ChatLog,
  | 'outcome'
  | 'sections'
  | 'cutoffApplied'
  | 'embedMs'
  | 'searchMs'
  | 'generateMs'
  | 'promptTokens'
  | 'completionTokens'
>;

const WINDOW_SECONDS = 60;

@Injectable()
export class ChatLogRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Checks the user's limit and, if there is room, writes their row, as one
   * step under a per-user lock. Without the lock, a burst of parallel requests
   * would all see room and all spend money.
   */
  reserve(
    userId: string,
    question: string,
    limitPerMinute: number,
  ): Promise<Reservation> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`rag-rate-limit:${userId}`],
      );
      const [{ count, seconds_left: secondsLeft }] = await manager.query<
        { count: string; seconds_left: string | null }[]
      >(
        `SELECT count(*) AS count,
                EXTRACT(EPOCH FROM min(created_at)
                  + make_interval(secs => $2) - now()) AS seconds_left
         FROM chat_log
         WHERE user_id = $1
           AND created_at > now() - make_interval(secs => $2)`,
        [userId, WINDOW_SECONDS],
      );

      if (Number(count) >= limitPerMinute) {
        return {
          allowed: false,
          // The wait until the oldest counted question leaves the window.
          retryAfterSeconds: Math.max(1, Math.ceil(Number(secondsLeft))),
        };
      }

      const id = randomUUID();
      await manager.insert(ChatLog, { id, userId, question });
      return { allowed: true, id };
    });
  }

  /** Records what happened to a question. */
  async complete(id: string, result: ChatLogResult): Promise<void> {
    await this.dataSource.getRepository(ChatLog).update(id, result);
  }

  /** Deletes rows past the retention period. Returns how many. */
  async deleteOlderThan(days: number): Promise<number> {
    const [, deleted] = await this.dataSource.query<[unknown[], number]>(
      `DELETE FROM chat_log WHERE created_at < now() - make_interval(days => $1)`,
      [days],
    );
    return deleted;
  }
}
