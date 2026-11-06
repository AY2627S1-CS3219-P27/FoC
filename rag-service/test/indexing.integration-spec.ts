import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { EMBEDDING_DIMENSIONS } from '../src/database/entities/index.js';
import { IndexingService } from '../src/indexing/indexing.service.js';
import type { OpenRouterClient } from '../src/openrouter/openrouter.client.js';

const HEADER = '---\ntitle: Errands\nservice: order-service\n---\n';

/** A unit vector along one axis, so distances are easy to reason about. */
function axis(position: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[position] = 1;
  return vector;
}

describe('indexing (real PostgreSQL with pgvector)', () => {
  let dataSource: DataSource;
  let folder: string;
  let model: string;
  let embed: ReturnType<typeof vi.fn>;
  let indexing: IndexingService;

  const sections = () =>
    dataSource
      .query<{ section: string }[]>(
        `SELECT section FROM chunks ORDER BY section`,
      )
      .then((rows) => rows.map(({ section }) => section));

  const writeDocument = (content: string) =>
    writeFileSync(join(folder, 'errands.md'), `${HEADER}${content}`);

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
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE chunks`);
    folder = mkdtempSync(join(tmpdir(), 'rag-indexing-'));
    writeDocument('## One\n\nFirst.\n\n## Two\n\nSecond.\n');
    model = 'test/model';
    embed = vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((_text, index) => axis(index))),
    );
    indexing = new IndexingService(
      dataSource,
      {
        embed,
        get embeddingModel() {
          return model;
        },
      } as unknown as OpenRouterClient,
      {
        get: () => folder,
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('stores one row per section, with its source and model', async () => {
    await expect(indexing.reindex()).resolves.toBe(2);

    const [row] = await dataSource.query<Record<string, unknown>[]>(
      `SELECT document, title, section, service, text, embedding_model
       FROM chunks WHERE section = 'One'`,
    );
    expect(row).toEqual({
      document: 'errands.md',
      title: 'Errands',
      section: 'One',
      service: 'order-service',
      text: 'First.',
      embedding_model: 'test/model',
    });
  });

  it('embeds the heading along with the words', async () => {
    await indexing.reindex();

    expect(embed.mock.calls[0][0]).toEqual([
      'Errands: One\n\nFirst.',
      'Errands: Two\n\nSecond.',
    ]);
  });

  it('finds the nearest chunk first', async () => {
    await indexing.reindex();

    const rows = await dataSource.query<{ section: string }[]>(
      `SELECT section FROM chunks ORDER BY embedding <=> $1::vector`,
      [JSON.stringify(axis(1))],
    );

    expect(rows.map(({ section }) => section)).toEqual(['Two', 'One']);
  });

  it('replaces the old chunks when run again', async () => {
    await indexing.reindex();
    writeDocument('## Three\n\nThird.\n');

    await indexing.reindex();

    await expect(sections()).resolves.toEqual(['Three']);
  });

  it('sends large document sets in batches', async () => {
    writeDocument(
      Array.from({ length: 150 }, (_, i) => `## S${i}\n\nWords.\n`).join('\n'),
    );

    await expect(indexing.reindex()).resolves.toBe(150);

    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([100, 50]);
  });

  describe('keeping the old index when a re-index fails', () => {
    beforeEach(async () => {
      await indexing.reindex();
      writeDocument('## Three\n\nThird.\n');
    });

    it('when OpenRouter fails', async () => {
      embed.mockRejectedValue(new Error('OpenRouter answered 500'));

      await expect(indexing.reindex()).rejects.toThrow('500');

      await expect(sections()).resolves.toEqual(['One', 'Two']);
    });

    it('when the documents are gone', async () => {
      rmSync(join(folder, 'errands.md'));

      await expect(indexing.reindex()).rejects.toThrow('No help documents');

      await expect(sections()).resolves.toEqual(['One', 'Two']);
    });

    it('when a document breaks the format rules', async () => {
      writeFileSync(join(folder, 'bad.md'), '## No header\n\nWords.\n');

      await expect(indexing.reindex()).rejects.toThrow('no front matter');

      await expect(sections()).resolves.toEqual(['One', 'Two']);
    });

    it('when the database refuses the new rows', async () => {
      embed.mockResolvedValue([[1, 2, 3]]);

      await expect(indexing.reindex()).rejects.toThrow();

      await expect(sections()).resolves.toEqual(['One', 'Two']);
    });
  });

  it('never mixes two re-indexes running at once', async () => {
    await Promise.all([indexing.reindex(), indexing.reindex()]);

    await expect(sections()).resolves.toEqual(['One', 'Two']);
  });

  describe('isUpToDate', () => {
    beforeEach(async () => {
      await indexing.reindex();
    });

    it('is true when nothing changed, without a model call', async () => {
      embed.mockClear();

      await expect(indexing.isUpToDate()).resolves.toBe(true);

      expect(embed).not.toHaveBeenCalled();
    });

    it('is false when the table is empty', async () => {
      await dataSource.query(`TRUNCATE chunks`);

      await expect(indexing.isUpToDate()).resolves.toBe(false);
    });

    it.each([
      ['a section is edited', '## One\n\nChanged.\n\n## Two\n\nSecond.\n'],
      [
        'a section is added',
        '## One\n\nFirst.\n\n## Two\n\nSecond.\n\n## New\n\nX.\n',
      ],
      ['a section is removed', '## One\n\nFirst.\n'],
      ['a heading is renamed', '## Uno\n\nFirst.\n\n## Two\n\nSecond.\n'],
    ])('is false when %s', async (_case, content) => {
      writeDocument(content);

      await expect(indexing.isUpToDate()).resolves.toBe(false);
    });

    it('is false when the embedding model changes', async () => {
      model = 'test/other-model';

      await expect(indexing.isUpToDate()).resolves.toBe(false);
    });

    it('is true again after re-indexing the change', async () => {
      writeDocument('## One\n\nChanged.\n');
      await indexing.reindex();

      await expect(indexing.isUpToDate()).resolves.toBe(true);
    });
  });
});
