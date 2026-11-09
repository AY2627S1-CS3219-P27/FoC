import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  OpenRouterClient,
  OpenRouterError,
} from '../src/openrouter/openrouter.client.js';
import { ChunkSearchService } from '../src/assistant/chunk-search.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';

describe('POST /assistant/questions (e2e)', () => {
  let app: INestApplication;
  let privateKey: string;
  let embed: ReturnType<typeof vi.fn>;
  let complete: ReturnType<typeof vi.fn>;
  let nearest: ReturnType<typeof vi.fn>;

  const ask = async (body: object, token?: string) =>
    request(app.getHttpServer())
      .post('/assistant/questions')
      .set(
        'Authorization',
        `Bearer ${token ?? (await signAccessToken(privateKey))}`,
      )
      .send(body);

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    const { AppModule } = await import('../src/app.module.js');
    embed = vi.fn();
    complete = vi.fn();
    nearest = vi.fn();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(OpenRouterClient)
      .useValue({ embed, complete, embeddingModel: 'test/model' })
      .overrideProvider(ChunkSearchService)
      .useValue({ nearest })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    embed.mockReset().mockResolvedValue([[0.1]]);
    complete.mockReset().mockResolvedValue({ text: 'Do this.\nSOURCES: 1' });
    nearest.mockReset().mockResolvedValue([
      {
        id: 'a',
        title: 'Errands',
        section: 'Can I cancel?',
        text: 'Yes.',
        score: 0.8,
      },
    ]);
  });

  it('answers with its sources', async () => {
    const response = await ask({ question: 'can I cancel?' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      answer: 'Do this.',
      answered: true,
      sources: [{ title: 'Errands', section: 'Can I cancel?' }],
    });
  });

  it('accepts the login cookie the browser sends', async () => {
    await request(app.getHttpServer())
      .post('/assistant/questions')
      .set(
        'Cookie',
        `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`,
      )
      .send({ question: 'can I cancel?' })
      .expect(200);
  });

  it('answers 200 with answered false when nothing is relevant', async () => {
    nearest.mockResolvedValue([]);

    const response = await ask({ question: 'weather?' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ answered: false, sources: [] });
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects a request without a token, before any model call', async () => {
    const response = await request(app.getHttpServer())
      .post('/assistant/questions')
      .send({ question: 'hello' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
    expect(embed).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const response = await ask(
      { question: 'hello' },
      await signAccessToken(privateKey, { expiresIn: -60 }),
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ['a missing question', {}],
    ['an empty question', { question: '' }],
    ['only spaces', { question: '    ' }],
    ['one too many characters', { question: 'x'.repeat(501) }],
    ['a question that is not text', { question: 42 }],
    ['an unknown field', { question: 'hi', userId: 'someone' }],
  ])('rejects %s with 400 before any model call', async (_case, body) => {
    const response = await ask(body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(embed).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 characters, measured after trimming', async () => {
    const response = await ask({ question: `  ${'x'.repeat(500)}  ` });

    expect(response.status).toBe(200);
    expect(embed.mock.calls[0][0]).toEqual(['x'.repeat(500)]);
  });

  it('answers a retryable 503 when OpenRouter fails', async () => {
    complete.mockRejectedValue(new OpenRouterError('timeout', 'too slow'));

    const response = await ask({ question: 'hello' });

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
  });

  it('answers a retryable 503 when the database is down', async () => {
    nearest.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );

    const response = await ask({ question: 'hello' });

    expect(response.status).toBe(503);
    expect(response.body.retryable).toBe(true);
  });
});
