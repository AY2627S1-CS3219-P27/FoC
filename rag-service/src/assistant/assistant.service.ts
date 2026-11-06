import {
  HttpException,
  HttpStatus,
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
import {
  ChatLogRepository,
  type ChatLogResult,
} from './chat-log.repository.js';
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
/**
 * Caps the cost of one answer. The model's hidden reasoning counts against it
 * (up to about 190 tokens measured, with totals up to about 440), so a lower
 * limit cuts real answers off.
 */
const MAX_ANSWER_TOKENS = 1000;

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
    private readonly chatLog: ChatLogRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Answers one question for the user. Their limit is checked and their row
   * written before any paid call; if the database is down, that fails first
   * and the shared error filter answers 503 without spending anything.
   */
  async ask(userId: string, question: string): Promise<AssistantAnswer> {
    const reservation = await this.chatLog.reserve(
      userId,
      question,
      this.config.get('RATE_LIMIT_PER_MINUTE', { infer: true }),
    );
    if (!reservation.allowed) {
      throw new HttpException(
        {
          code: ErrorCode.RateLimited,
          message:
            'You are asking questions too quickly. Please wait a moment.',
          retryAfterSeconds: reservation.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result: ChatLogResult = {
      outcome: 'error',
      sections: [],
      cutoffApplied: false,
      embedMs: null,
      searchMs: null,
      generateMs: null,
      promptTokens: null,
      completionTokens: null,
    };
    try {
      return await this.answer(question, result);
    } finally {
      await this.record(reservation.id, userId, result);
    }
  }

  /** Fills in `result` as it goes, so a failure still records how far it got. */
  private async answer(
    question: string,
    result: ChatLogResult,
  ): Promise<AssistantAnswer> {
    let started = Date.now();
    const [embedding] = await this.callModel(() =>
      this.openRouter.embed([question], EMBEDDING_TIMEOUT_MS),
    );
    result.embedMs = Date.now() - started;

    started = Date.now();
    const nearest = await this.search.nearest(
      embedding,
      this.openRouter.embeddingModel,
      MAX_SECTIONS,
    );
    result.searchMs = Date.now() - started;
    result.sections = nearest.map(({ id, score }) => ({ id, score }));

    const cutoff = this.config.get('RELEVANCE_CUTOFF', { infer: true });
    const sections = nearest.filter(({ score }) => score >= cutoff);

    // Nothing relevant: cheaper to stop here, and nothing can be made up.
    if (sections.length === 0) {
      result.outcome = 'no_match';
      result.cutoffApplied = true;
      return noAnswer();
    }

    started = Date.now();
    const completion = await this.callModel(() =>
      this.openRouter.complete({
        system: SYSTEM_PROMPT,
        user: buildUserMessage(sections, question),
        maxTokens: MAX_ANSWER_TOKENS,
        timeoutMs: CHAT_TIMEOUT_MS,
      }),
    );
    result.generateMs = Date.now() - started;
    result.promptTokens = completion.promptTokens;
    result.completionTokens = completion.completionTokens;

    const reply = parseReply(completion.text, sections.length);
    switch (reply.kind) {
      case 'no-answer':
        result.outcome = 'refused';
        return noAnswer();
      case 'empty':
        this.logger.warn('The chat model sent an empty reply');
        throw unavailable();
      case 'answer':
        result.outcome = 'answered';
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

  /**
   * The log line goes to Loki, so it holds the user's id only, never the
   * question, email or token. A failed write must not cost the user an answer
   * that has already been paid for.
   */
  private async record(
    id: string,
    userId: string,
    result: ChatLogResult,
  ): Promise<void> {
    this.logger.log(JSON.stringify({ id, userId, ...result }));
    try {
      await this.chatLog.complete(id, result);
    } catch (error) {
      this.logger.warn(
        `Could not record chat_log row ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
