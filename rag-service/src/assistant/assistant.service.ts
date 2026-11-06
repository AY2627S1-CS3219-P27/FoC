import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../common/errors/error-response.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import {
  OpenRouterClient,
  OpenRouterError,
} from '../openrouter/openrouter.client.js';
import { ChunkSearchService } from './chunk-search.service.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt-builder.js';
import { parseReply } from './reply-parser.js';

/** How many sections the chat model is given at most. */
const MAX_SECTIONS = 4;
/**
 * The frontend's proxy gives up after about 30 seconds, so these two limits
 * must add up to less than that.
 */
const EMBEDDING_TIMEOUT_MS = 5_000;
const CHAT_TIMEOUT_MS = 20_000;
/** Caps the cost of one answer; the rules ask for far less. */
const MAX_ANSWER_TOKENS = 500;

export const NO_ANSWER_MESSAGE =
  "I can't answer that from the FoC help documents. I also can't see your account, so to check your own balance or errands, open them in the app. For anything else, please contact an admin.";

export interface AssistantAnswer {
  answer: string;
  answered: boolean;
  sources: { title: string; section: string }[];
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly openRouter: OpenRouterClient,
    private readonly search: ChunkSearchService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async ask(question: string): Promise<AssistantAnswer> {
    const [embedding] = await this.callModel(() =>
      this.openRouter.embed([question], EMBEDDING_TIMEOUT_MS),
    );

    const cutoff = this.config.get('RELEVANCE_CUTOFF', { infer: true });
    const sections = (
      await this.search.nearest(
        embedding,
        this.openRouter.embeddingModel,
        MAX_SECTIONS,
      )
    ).filter(({ score }) => score >= cutoff);

    // Nothing relevant: cheaper to stop here, and nothing can be made up.
    if (sections.length === 0) {
      return noAnswer();
    }

    const { text } = await this.callModel(() =>
      this.openRouter.complete({
        system: SYSTEM_PROMPT,
        user: buildUserMessage(sections, question),
        maxTokens: MAX_ANSWER_TOKENS,
        timeoutMs: CHAT_TIMEOUT_MS,
      }),
    );

    const reply = parseReply(text, sections.length);
    switch (reply.kind) {
      case 'no-answer':
        return noAnswer();
      case 'empty':
        this.logger.warn('The chat model sent an empty reply');
        throw unavailable();
      case 'answer':
        return {
          answer: reply.answer,
          answered: true,
          sources: reply.sectionIndexes.map((index) => ({
            title: sections[index].title,
            section: sections[index].section,
          })),
        };
    }
  }

  /** A failed model call is a retryable 503, never a wrong answer. */
  private async callModel<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof OpenRouterError) {
        this.logger.warn(`Model call failed (${error.kind}): ${error.message}`);
        throw unavailable();
      }
      throw error;
    }
  }
}

function noAnswer(): AssistantAnswer {
  return { answer: NO_ANSWER_MESSAGE, answered: false, sources: [] };
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: ErrorCode.DependencyUnavailable,
    message: 'The help bot is temporarily unavailable. Please retry.',
  });
}
