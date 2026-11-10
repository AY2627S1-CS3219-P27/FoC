import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ChatLogRepository } from '../src/assistant/chat-log.repository.js';
import { createDatabaseOptions } from '../src/database/database-options.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('chat_log (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let chatLog: ChatLogRepository;

  const rows = (userId = USER) =>
    dataSource
      .query<{ count: string }[]>(
        `SELECT count(*) AS count FROM chat_log WHERE user_id = $1`,
        [userId],
      )
      .then(([{ count }]) => Number(count));

  /** Moves every row back in time. */
  const age = (interval: string) =>
    dataSource.query(
      `UPDATE chat_log SET created_at = created_at - $1::interval`,
      [interval],
    );

  beforeAll(async () => {
    dataSource = new DataSource({
      ...createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    });
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    chatLog = new ChatLogRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE chat_log`);
  });

  describe('the rate limit', () => {
    it('allows up to the limit, then refuses and writes nothing', async () => {
      for (let i = 0; i < 3; i += 1) {
        await expect(chatLog.reserve(USER, 'q', 3)).resolves.toMatchObject({
          allowed: true,
        });
      }

      await expect(chatLog.reserve(USER, 'q', 3)).resolves.toMatchObject({
        allowed: false,
      });
      await expect(rows()).resolves.toBe(3);
    });

    it('says how long to wait, based on the oldest question', async () => {
      await chatLog.reserve(USER, 'q', 1);
      await age('20 seconds');

      const result = await chatLog.reserve(USER, 'q', 1);

      expect(result).toMatchObject({ allowed: false });
      const { retryAfterSeconds } = result as { retryAfterSeconds: number };
      expect(retryAfterSeconds).toBeGreaterThanOrEqual(39);
      expect(retryAfterSeconds).toBeLessThanOrEqual(41);
    });

    it('allows again once questions leave the 60-second window', async () => {
      await chatLog.reserve(USER, 'q', 1);
      await age('61 seconds');

      await expect(chatLog.reserve(USER, 'q', 1)).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('counts each user separately', async () => {
      await chatLog.reserve(USER, 'q', 1);

      await expect(chatLog.reserve(OTHER, 'q', 1)).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('holds under a burst of parallel requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, () => chatLog.reserve(USER, 'q', 10)),
      );

      expect(results.filter(({ allowed }) => allowed)).toHaveLength(10);
      await expect(rows()).resolves.toBe(10);
    });
  });

  it('stores a new row as pending, then what happened', async () => {
    const reservation = await chatLog.reserve(USER, 'how?', 10);
    if (!reservation.allowed) {
      throw new Error('expected room');
    }

    const [before] = await dataSource.query<Record<string, unknown>[]>(
      `SELECT outcome, question FROM chat_log`,
    );
    expect(before).toEqual({ outcome: 'pending', question: 'how?' });

    await chatLog.complete(reservation.id, {
      outcome: 'answered',
      sections: [{ id: 'a', score: 0.7 }],
      cutoffApplied: false,
      embedMs: 1,
      searchMs: 2,
      generateMs: 3,
      promptTokens: 4,
      completionTokens: 5,
    });

    const [after] = await dataSource.query<Record<string, unknown>[]>(
      `SELECT outcome, sections, generate_ms, completion_tokens FROM chat_log`,
    );
    expect(after).toEqual({
      outcome: 'answered',
      sections: [{ id: 'a', score: 0.7 }],
      generate_ms: 3,
      completion_tokens: 5,
    });
  });

  it('refuses an unknown outcome', async () => {
    await chatLog.reserve(USER, 'q', 10);

    await expect(
      dataSource.query(`UPDATE chat_log SET outcome = 'made-up'`),
    ).rejects.toThrow('CHK_chat_log_outcome');
  });

  describe('deleteOlderThan', () => {
    it('deletes only rows past the retention period', async () => {
      await chatLog.reserve(USER, 'old', 10);
      await age('31 days');
      await chatLog.reserve(USER, 'new', 10);

      await expect(chatLog.deleteOlderThan(30)).resolves.toBe(1);

      const remaining = await dataSource.query<{ question: string }[]>(
        `SELECT question FROM chat_log`,
      );
      expect(remaining).toEqual([{ question: 'new' }]);
    });

    it('deletes nothing when nothing is old', async () => {
      await chatLog.reserve(USER, 'new', 10);

      await expect(chatLog.deleteOlderThan(30)).resolves.toBe(0);
    });
  });
});
