import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { EMBEDDING_DIMENSIONS } from '../database/entities/index.js';
import { OpenRouterClient, OpenRouterError } from './openrouter.client.js';

const vector = (value: number): number[] =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);

describe('OpenRouterClient.embed', () => {
  let dir: string;
  let keyFile: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: OpenRouterClient;

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-openrouter-'));
    keyFile = join(dir, 'key');
    writeFileSync(keyFile, 'sk-secret\n');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const settings: Record<string, string> = {
      OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
      OPENROUTER_EMBEDDING_MODEL: 'test/model',
      OPENROUTER_CHAT_MODEL: 'test/chat',
      OPENROUTER_API_KEY_FILE: keyFile,
    };
    client = new OpenRouterClient({
      get: (key: string) => settings[key],
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends the texts and the key, and returns the vectors', async () => {
    fetchMock.mockResolvedValue(
      reply({ data: [{ index: 0, embedding: vector(0.5) }] }),
    );

    await expect(client.embed(['hello'], 1000)).resolves.toEqual([vector(0.5)]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.test/api/v1/embeddings');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-secret' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'test/model',
      input: ['hello'],
    });
  });

  it('puts vectors in the order of the texts, whatever order they return', async () => {
    fetchMock.mockResolvedValue(
      reply({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
      }),
    );

    await expect(client.embed(['a', 'b'], 1000)).resolves.toEqual([
      vector(1),
      vector(2),
    ]);
  });

  it.each([
    ['too few vectors', { data: [] }],
    ['no data', {}],
    ['a vector of the wrong size', { data: [{ embedding: [1, 2] }] }],
    [
      'a vector holding a non-number',
      { data: [{ embedding: [...vector(1).slice(1), 'x'] }] },
    ],
  ])('rejects a reply with %s', async (_case, body) => {
    fetchMock.mockResolvedValue(reply(body));

    await expect(client.embed(['a'], 1000)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('rejects a repeated index, which would lose a text', async () => {
    fetchMock.mockResolvedValue(
      reply({
        data: [
          { index: 0, embedding: vector(1) },
          { index: 0, embedding: vector(2) },
        ],
      }),
    );

    await expect(client.embed(['a', 'b'], 1000)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('rejects an index outside the texts', async () => {
    fetchMock.mockResolvedValue(
      reply({ data: [{ index: 5, embedding: vector(1) }] }),
    );

    await expect(client.embed(['a'], 1000)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('treats an error inside a 200 reply as a failure', async () => {
    fetchMock.mockResolvedValue(reply({ error: { code: 402 } }));

    await expect(client.embed(['a'], 1000)).rejects.toMatchObject({
      kind: 'http',
    });
  });

  it('reports an HTTP failure without repeating the body', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'bad key sk-secret' }, 401));

    const error = await client.embed(['a'], 1000).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).message).toBe('OpenRouter answered 401');
  });

  it('reports a timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    await expect(client.embed(['a'], 1000)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.embed(['a'], 1000)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it.each([
    ['an empty key file', () => writeFileSync(keyFile, '\n')],
    ['a missing key file', () => rmSync(keyFile)],
  ])('fails without calling out on %s', async (_case, prepare) => {
    prepare();

    await expect(client.embed(['a'], 1000)).rejects.toBeInstanceOf(
      OpenRouterError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenRouterClient.complete', () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: OpenRouterClient;

  const request = {
    system: 'rules',
    user: 'hi',
    maxTokens: 50,
    timeoutMs: 1000,
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-openrouter-'));
    const keyFile = join(dir, 'key');
    writeFileSync(keyFile, 'sk-secret\n');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const settings: Record<string, string> = {
      OPENROUTER_BASE_URL: 'https://openrouter.test/api/v1',
      OPENROUTER_CHAT_MODEL: 'test/chat',
      OPENROUTER_API_KEY_FILE: keyFile,
    };
    client = new OpenRouterClient({
      get: (key: string) => settings[key],
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends the rules and question separately, with its limits', async () => {
    fetchMock.mockResolvedValue(
      reply({
        choices: [{ message: { content: 'Hello.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );

    await expect(client.complete(request)).resolves.toEqual({
      text: 'Hello.',
      promptTokens: 12,
      completionTokens: 3,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'test/chat',
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hi' },
      ],
      max_tokens: 50,
      provider: { data_collection: 'deny' },
    });
  });

  it('rejects a reply cut off at the token limit', async () => {
    fetchMock.mockResolvedValue(
      reply({
        choices: [
          { message: { content: 'Step 1. Step' }, finish_reason: 'length' },
        ],
      }),
    );

    await expect(client.complete(request)).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'The reply was cut off at 50 tokens',
    });
  });

  it('accepts a reply that finished normally', async () => {
    fetchMock.mockResolvedValue(
      reply({
        choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
      }),
    );

    await expect(client.complete(request)).resolves.toMatchObject({
      text: 'Done.',
    });
  });

  it('copes with a reply that has no token counts', async () => {
    fetchMock.mockResolvedValue(
      reply({ choices: [{ message: { content: 'Hello.' } }] }),
    );

    await expect(client.complete(request)).resolves.toMatchObject({
      promptTokens: null,
      completionTokens: null,
    });
  });

  it.each([
    ['no choices', {}],
    ['an empty list', { choices: [] }],
    ['no text', { choices: [{ message: {} }] }],
  ])('rejects a reply with %s', async (_case, body) => {
    fetchMock.mockResolvedValue(reply(body));

    await expect(client.complete(request)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('treats an error inside a 200 reply as a failure', async () => {
    fetchMock.mockResolvedValue(reply({ error: { code: 429 } }));

    await expect(client.complete(request)).rejects.toBeInstanceOf(
      OpenRouterError,
    );
  });
});
