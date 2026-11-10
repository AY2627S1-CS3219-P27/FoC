import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { EMBEDDING_DIMENSIONS } from '../database/entities/index.js';

/** Students' questions reach both endpoints; no provider may store them. */
const PROVIDER_ROUTING = { data_collection: 'deny' } as const;

/** A model call that gave no usable answer. Never carries the API key. */
export class OpenRouterError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'invalid-response',
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

interface ReplyError {
  code?: unknown;
  message?: unknown;
}

interface EmbeddingsReply {
  data?: { index?: unknown; embedding?: unknown }[];
  error?: ReplyError;
}

interface ChatReply {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: ReplyError;
}

export interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface ChatCompletion {
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** The one place that calls OpenRouter. */
@Injectable()
export class OpenRouterClient {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** The model whose vectors embed() returns. */
  get embeddingModel(): string {
    return this.config.get('OPENROUTER_EMBEDDING_MODEL', { infer: true });
  }

  /**
   * Turns each text into its embedding, in the same order as the texts. The
   * reply is checked before use: a wrong count or size would otherwise reach
   * the database or, worse, a search.
   */
  async embed(texts: string[], timeoutMs: number): Promise<number[][]> {
    const reply = await this.post<EmbeddingsReply>(
      '/embeddings',
      {
        model: this.embeddingModel,
        input: texts,
        encoding_format: 'float',
        provider: PROVIDER_ROUTING,
      },
      timeoutMs,
    );

    if (!Array.isArray(reply.data) || reply.data.length !== texts.length) {
      throw new OpenRouterError(
        'invalid-response',
        `Expected ${texts.length} embeddings, got ${
          Array.isArray(reply.data) ? reply.data.length : 'none'
        }`,
      );
    }

    const embeddings = new Map<number, number[]>();
    reply.data.forEach((item, position) => {
      const index = typeof item.index === 'number' ? item.index : position;
      const inRange =
        Number.isInteger(index) && index >= 0 && index < texts.length;
      if (!inRange || embeddings.has(index) || !isEmbedding(item.embedding)) {
        throw new OpenRouterError(
          'invalid-response',
          `Embedding ${position} has a bad position or is not ${EMBEDDING_DIMENSIONS} numbers`,
        );
      }
      embeddings.set(index, item.embedding);
    });
    return texts.map((_text, index) => embeddings.get(index)!);
  }

  /** Asks the chat model for one reply. */
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    const reply = await this.post<ChatReply>(
      '/chat/completions',
      {
        model: this.config.get('OPENROUTER_CHAT_MODEL', { infer: true }),
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        max_tokens: request.maxTokens,
        provider: PROVIDER_ROUTING,
      },
      request.timeoutMs,
    );

    const text = reply.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new OpenRouterError('invalid-response', 'The reply has no text');
    }
    // Cut off at the token limit: half an answer must never reach a student.
    if (reply.choices?.[0]?.finish_reason === 'length') {
      throw new OpenRouterError(
        'invalid-response',
        `The reply was cut off at ${request.maxTokens} tokens`,
      );
    }
    return {
      text,
      promptTokens: tokenCount(reply.usage?.prompt_tokens),
      completionTokens: tokenCount(reply.usage?.completion_tokens),
    };
  }

  private async post<T extends { error?: ReplyError }>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const baseUrl = this.config.get('OPENROUTER_BASE_URL', { infer: true });
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.readApiKey()}`,
          'Content-Type': 'application/json',
          'X-Title': 'FoC help bot',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new OpenRouterError(
          'timeout',
          `OpenRouter gave no answer within ${timeoutMs} ms`,
        );
      }
      if (error instanceof OpenRouterError) {
        throw error;
      }
      throw new OpenRouterError('network', 'Could not reach OpenRouter');
    }

    if (!response.ok) {
      throw new OpenRouterError(
        'http',
        `OpenRouter answered ${response.status}`,
      );
    }

    let reply: T;
    try {
      reply = (await response.json()) as T;
    } catch {
      throw new OpenRouterError('invalid-response', 'OpenRouter sent bad JSON');
    }
    // OpenRouter can report a failure inside a 200 reply.
    if (reply.error) {
      throw new OpenRouterError(
        'http',
        `OpenRouter reported an error (${
          typeof reply.error.code === 'number' ||
          typeof reply.error.code === 'string'
            ? reply.error.code
            : 'no code'
        })`,
      );
    }
    return reply;
  }

  /** Read on each call, so a missing or stub key cannot stop the service. */
  private readApiKey(): string {
    const path = this.config.get('OPENROUTER_API_KEY_FILE', { infer: true });
    let key: string;
    try {
      key = readFileSync(path, 'utf8').trim();
    } catch {
      throw new OpenRouterError('http', 'Cannot read the OpenRouter key file');
    }
    if (key.length === 0) {
      throw new OpenRouterError('http', 'The OpenRouter key file is empty');
    }
    return key;
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}
