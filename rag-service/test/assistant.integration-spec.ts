import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AssistantService } from '../src/assistant/assistant.service.js';
import { ChatLogRepository } from '../src/assistant/chat-log.repository.js';
import { ChunkSearchService } from '../src/assistant/chunk-search.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { Chunk, EMBEDDING_DIMENSIONS } from '../src/database/entities/index.js';
import type { OpenRouterClient } from '../src/openrouter/openrouter.client.js';

/** A unit vector along one axis: another axis scores 0, the same axis 1. */
function axis(position: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[position] = 1;
  return vector;
}

/** Between two axes, so it scores about 0.71 against each. */
function between(first: number, second: number): number[] {
  const vector = axis(first);
  vector[second] = 1;
  return vector;
}

const USER = '11111111-1111-4111-8111-111111111111';

describe('answering (real PostgreSQL with pgvector)', () => {
  let dataSource: DataSource;
  let search: ChunkSearchService;

  const store = (
    section: string,
    embedding: number[],
    embeddingModel = 'test/model',
  ) =>
    dataSource.getRepository(Chunk).insert({
      id: randomUUID(),
      document: 'errands.md',
      title: 'Errands',
      section,
      service: 'order-service',
      text: `About ${section}`,
      embedding,
      embeddingModel,
    });

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    search = new ChunkSearchService(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE chunks, chat_log`);
  });

  describe('ChunkSearchService', () => {
    it('returns the nearest first, with scores as numbers', async () => {
      await store('Far', axis(5));
      await store('Near', axis(0));
      await store('Middle', between(0, 1));

      const found = await search.nearest(axis(0), 'test/model', 4);

      expect(found.map(({ section }) => section)).toEqual([
        'Near',
        'Middle',
        'Far',
      ]);
      expect(found[0].score).toBeCloseTo(1);
      expect(found[1].score).toBeCloseTo(0.707, 2);
      expect(found[2].score).toBeCloseTo(0);
    });

    it('returns at most the limit', async () => {
      for (let i = 0; i < 6; i += 1) {
        await store(`S${i}`, axis(i));
      }

      await expect(
        search.nearest(axis(0), 'test/model', 4),
      ).resolves.toHaveLength(4);
    });

    it('ignores chunks from another embedding model', async () => {
      await store('Old model', axis(0), 'old/model');

      await expect(search.nearest(axis(0), 'test/model', 4)).resolves.toEqual(
        [],
      );
    });
  });

  describe('AssistantService with the real search', () => {
    let complete: ReturnType<typeof vi.fn>;
    let assistant: AssistantService;

    beforeEach(() => {
      complete = vi.fn().mockResolvedValue({ text: 'Do this.\nSOURCES: 1' });
      assistant = new AssistantService(
        {
          embed: vi.fn().mockResolvedValue([axis(0)]),
          complete,
          embeddingModel: 'test/model',
        } as unknown as OpenRouterClient,
        search,
        new ChatLogRepository(dataSource),
        {
          get: (key: string) => (key === 'RELEVANCE_CUTOFF' ? 0.5 : 10),
        } as unknown as ConfigService<EnvironmentVariables, true>,
      );
    });

    it('answers from the section that matches', async () => {
      await store('Near', axis(0));

      await expect(assistant.ask(USER, 'how?')).resolves.toMatchObject({
        answered: true,
        sources: [{ title: 'Errands', section: 'Near' }],
      });
    });

    it('drops sections below the cutoff before calling the model', async () => {
      await store('Near', axis(0));
      await store('Far', axis(7));

      await assistant.ask(USER, 'how?');

      expect(complete.mock.calls[0][0].user).not.toContain('About Far');
    });

    it('makes no chat call when only far sections exist', async () => {
      await store('Far', axis(7));

      await expect(assistant.ask(USER, 'weather?')).resolves.toMatchObject({
        answered: false,
      });
      expect(complete).not.toHaveBeenCalled();
    });

    it('records the outcome and scores in chat_log', async () => {
      await store('Near', axis(0));
      await store('Far', axis(7));

      await assistant.ask(USER, 'how?');

      const [row] = await dataSource.query<Record<string, any>[]>(
        `SELECT user_id, question, outcome, sections, cutoff_applied FROM chat_log`,
      );
      expect(row).toMatchObject({
        user_id: USER,
        question: 'how?',
        outcome: 'answered',
        cutoff_applied: false,
      });
      expect(row.sections).toHaveLength(2);
      expect(row.sections[0].score).toBeCloseTo(1);
    });

    it('answers 503 with no chat call on an empty index', async () => {
      await expect(assistant.ask(USER, 'how?')).rejects.toThrow(
        /temporarily unavailable/,
      );
      expect(complete).not.toHaveBeenCalled();
    });
  });
});
