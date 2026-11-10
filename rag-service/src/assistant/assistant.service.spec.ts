import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  type OpenRouterClient,
  OpenRouterError,
} from '../openrouter/openrouter.client.js';
import { AssistantService, NO_ANSWER_MESSAGE } from './assistant.service.js';
import type { ChatLogRepository } from './chat-log.repository.js';
import type { ChunkSearchService } from './chunk-search.service.js';
import { SYSTEM_PROMPT } from './prompt-builder.js';

const chunk = (section: string, score: number) => ({
  id: section,
  title: 'Errands',
  section,
  text: `About ${section}`,
  score,
});

const USER = '11111111-1111-4111-8111-111111111111';

describe('AssistantService', () => {
  let embed: ReturnType<typeof vi.fn>;
  let complete: ReturnType<typeof vi.fn>;
  let nearest: ReturnType<typeof vi.fn>;
  let reserve: ReturnType<typeof vi.fn>;
  let record: ReturnType<typeof vi.fn>;
  let logLine: ReturnType<typeof vi.spyOn>;
  let service: AssistantService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logLine = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    reserve = vi.fn().mockResolvedValue({ allowed: true, id: 'row' });
    record = vi.fn().mockResolvedValue(undefined);
    embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    complete = vi.fn().mockResolvedValue({ text: 'Do this.\nSOURCES: 1' });
    nearest = vi.fn().mockResolvedValue([chunk('One', 0.8), chunk('Two', 0.5)]);
    service = new AssistantService(
      {
        embed,
        complete,
        embeddingModel: 'test/model',
      } as unknown as OpenRouterClient,
      { nearest } as unknown as ChunkSearchService,
      { reserve, complete: record } as unknown as ChatLogRepository,
      {
        get: (key: string) => (key === 'RELEVANCE_CUTOFF' ? 0.3 : 10),
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers from the sections and names the ones used', async () => {
    await expect(service.ask(USER, 'how?')).resolves.toEqual({
      answer: 'Do this.',
      answered: true,
      sources: [{ title: 'Errands', section: 'One' }],
    });

    expect(nearest).toHaveBeenCalledWith([0.1, 0.2], 'test/model', 4);
    const request = complete.mock.calls[0][0];
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.user).toContain('About One');
    expect(request.user).toContain('<question>how?</question>');
    expect(request.maxTokens).toBe(1000);
  });

  it('skips the chat model when nothing is relevant enough', async () => {
    nearest.mockResolvedValue([chunk('One', 0.29)]);

    await expect(service.ask(USER, 'weather?')).resolves.toEqual({
      answer: NO_ANSWER_MESSAGE,
      answered: false,
      sources: [],
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('answers 503, not a refusal, when the index is empty', async () => {
    nearest.mockResolvedValue([]);

    await expect(service.ask(USER, 'how?')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(complete).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      'row',
      expect.objectContaining({ outcome: 'error' }),
    );
  });

  it('sends only the sections above the cutoff', async () => {
    nearest.mockResolvedValue([chunk('One', 0.8), chunk('Far', 0.1)]);

    await service.ask(USER, 'how?');

    expect(complete.mock.calls[0][0].user).not.toContain('About Far');
  });

  it('counts a score exactly on the cutoff as relevant', async () => {
    nearest.mockResolvedValue([chunk('One', 0.3)]);

    await expect(service.ask(USER, 'how?')).resolves.toMatchObject({
      answered: true,
    });
  });

  it('replaces the refusal marker with the standard message', async () => {
    complete.mockResolvedValue({ text: '[NO_ANSWER]' });

    await expect(service.ask(USER, 'my balance?')).resolves.toEqual({
      answer: NO_ANSWER_MESSAGE,
      answered: false,
      sources: [],
    });
  });

  it('answers 503 when the chat model sends nothing', async () => {
    complete.mockResolvedValue({ text: ' ' });

    await expect(service.ask(USER, 'how?')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each([
    ['embedding', () => embed],
    ['chat', () => complete],
  ])('answers 503 when the %s call fails', async (_case, mock) => {
    mock().mockRejectedValue(new OpenRouterError('timeout', 'too slow'));

    await expect(service.ask(USER, 'how?')).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
    });
  });

  it('leaves database failures to the shared error filter', async () => {
    const failure = new Error('connect ECONNREFUSED');
    nearest.mockRejectedValue(failure);

    await expect(service.ask(USER, 'how?')).rejects.toBe(failure);
  });

  it('never sends who is asking to the model', async () => {
    await service.ask(USER, 'how?');

    expect(Object.keys(complete.mock.calls[0][0]).sort()).toEqual([
      'maxTokens',
      'system',
      'timeoutMs',
      'user',
    ]);
  });

  describe('rate limit', () => {
    it('checks the limit before any paid call', async () => {
      await service.ask(USER, 'how?');

      expect(reserve).toHaveBeenCalledWith(USER, 'how?', 10);
      expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
        embed.mock.invocationCallOrder[0],
      );
    });

    it('refuses with the wait, and spends nothing, when over it', async () => {
      reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });

      await expect(service.ask(USER, 'how?')).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          code: 'RATE_LIMITED',
          retryAfterSeconds: 12,
        }),
      });
      expect(embed).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('spends nothing when the limit cannot be checked', async () => {
      reserve.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.ask(USER, 'how?')).rejects.toThrow('ECONNREFUSED');
      expect(embed).not.toHaveBeenCalled();
    });
  });

  describe('chat_log', () => {
    const recorded = () => record.mock.calls[0][1];

    it('records an answer with its sections, timings and tokens', async () => {
      complete.mockResolvedValue({
        text: 'Do this.\nSOURCES: 1',
        promptTokens: 900,
        completionTokens: 30,
      });

      await service.ask(USER, 'how?');

      expect(record.mock.calls[0][0]).toBe('row');
      expect(recorded()).toMatchObject({
        outcome: 'answered',
        cutoffApplied: false,
        sections: [
          { id: 'One', score: 0.8 },
          { id: 'Two', score: 0.5 },
        ],
        promptTokens: 900,
        completionTokens: 30,
      });
      expect(recorded().embedMs).toEqual(expect.any(Number));
      expect(recorded().searchMs).toEqual(expect.any(Number));
      expect(recorded().generateMs).toEqual(expect.any(Number));
    });

    it('records a cutoff stop, keeping the scores that fell short', async () => {
      nearest.mockResolvedValue([chunk('Far', 0.1)]);

      await service.ask(USER, 'weather?');

      expect(recorded()).toMatchObject({
        outcome: 'no_match',
        cutoffApplied: true,
        sections: [{ id: 'Far', score: 0.1 }],
        generateMs: null,
      });
    });

    it('records a refusal from the model', async () => {
      complete.mockResolvedValue({ text: '[NO_ANSWER]' });

      await service.ask(USER, 'my balance?');

      expect(recorded()).toMatchObject({ outcome: 'refused' });
    });

    it.each([
      ['the embedding call', () => embed],
      ['the chat call', () => complete],
    ])('records a failure of %s as an error', async (_case, mock) => {
      mock().mockRejectedValue(new OpenRouterError('timeout', 'too slow'));

      await expect(service.ask(USER, 'how?')).rejects.toMatchObject({
        status: 503,
      });

      expect(recorded()).toMatchObject({ outcome: 'error' });
    });

    it('records an empty reply as an error', async () => {
      complete.mockResolvedValue({ text: ' ' });

      await expect(service.ask(USER, 'how?')).rejects.toMatchObject({
        status: 503,
      });

      expect(recorded()).toMatchObject({ outcome: 'error' });
    });

    it('still gives the answer when recording it fails', async () => {
      record.mockRejectedValue(new Error('database gone'));

      await expect(service.ask(USER, 'how?')).resolves.toMatchObject({
        answered: true,
      });
    });

    it('never puts the question in the log line', async () => {
      await service.ask(USER, 'my private question');

      const lines = logLine.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .join();
      expect(lines).toContain(USER);
      expect(lines).toContain('answered');
      expect(lines).not.toContain('my private question');
    });
  });
});
