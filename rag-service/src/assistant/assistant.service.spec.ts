import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  type OpenRouterClient,
  OpenRouterError,
} from '../openrouter/openrouter.client.js';
import { AssistantService, NO_ANSWER_MESSAGE } from './assistant.service.js';
import type { ChunkSearchService } from './chunk-search.service.js';
import { SYSTEM_PROMPT } from './prompt-builder.js';

const chunk = (section: string, score: number) => ({
  id: section,
  title: 'Errands',
  section,
  text: `About ${section}`,
  score,
});

describe('AssistantService', () => {
  let embed: ReturnType<typeof vi.fn>;
  let complete: ReturnType<typeof vi.fn>;
  let nearest: ReturnType<typeof vi.fn>;
  let service: AssistantService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
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
      { get: () => 0.3 } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers from the sections and names the ones used', async () => {
    await expect(service.ask('how?')).resolves.toEqual({
      answer: 'Do this.',
      answered: true,
      sources: [{ title: 'Errands', section: 'One' }],
    });

    expect(nearest).toHaveBeenCalledWith([0.1, 0.2], 'test/model', 4);
    const request = complete.mock.calls[0][0];
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.user).toContain('About One');
    expect(request.user).toContain('<question>how?</question>');
    expect(request.maxTokens).toBe(500);
  });

  it('skips the chat model when nothing is relevant enough', async () => {
    nearest.mockResolvedValue([chunk('One', 0.29)]);

    await expect(service.ask('weather?')).resolves.toEqual({
      answer: NO_ANSWER_MESSAGE,
      answered: false,
      sources: [],
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips the chat model when the index is empty', async () => {
    nearest.mockResolvedValue([]);

    await expect(service.ask('how?')).resolves.toMatchObject({
      answered: false,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends only the sections above the cutoff', async () => {
    nearest.mockResolvedValue([chunk('One', 0.8), chunk('Far', 0.1)]);

    await service.ask('how?');

    expect(complete.mock.calls[0][0].user).not.toContain('About Far');
  });

  it('counts a score exactly on the cutoff as relevant', async () => {
    nearest.mockResolvedValue([chunk('One', 0.3)]);

    await expect(service.ask('how?')).resolves.toMatchObject({
      answered: true,
    });
  });

  it('replaces the refusal marker with the standard message', async () => {
    complete.mockResolvedValue({ text: '[NO_ANSWER]' });

    await expect(service.ask('my balance?')).resolves.toEqual({
      answer: NO_ANSWER_MESSAGE,
      answered: false,
      sources: [],
    });
  });

  it('answers 503 when the chat model sends nothing', async () => {
    complete.mockResolvedValue({ text: ' ' });

    await expect(service.ask('how?')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each([
    ['embedding', () => embed],
    ['chat', () => complete],
  ])('answers 503 when the %s call fails', async (_case, mock) => {
    mock().mockRejectedValue(new OpenRouterError('timeout', 'too slow'));

    await expect(service.ask('how?')).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
    });
  });

  it('leaves database failures to the shared error filter', async () => {
    const failure = new Error('connect ECONNREFUSED');
    nearest.mockRejectedValue(failure);

    await expect(service.ask('how?')).rejects.toBe(failure);
  });

  it('never sends who is asking to the model', async () => {
    await service.ask('how?');

    expect(Object.keys(complete.mock.calls[0][0]).sort()).toEqual([
      'maxTokens',
      'system',
      'timeoutMs',
      'user',
    ]);
  });
});
