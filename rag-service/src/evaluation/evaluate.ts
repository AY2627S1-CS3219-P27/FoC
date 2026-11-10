import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { readDatabasePassword } from '../database/database-options.js';
import {
  buildReport,
  type EvalObservation,
  type EvalQuestion,
  renderReport,
  scoreQuestion,
} from './score.js';

/**
 * `npm run evaluate`: asks the fixed questions through the real API, with a
 * real key, and prints a report. This spends a little money, so CI never runs
 * it. Run it in the container (see the README).
 */
const QUESTIONS_FILE = new URL('../../eval/questions.json', import.meta.url);
const BASE_URL = process.env.EVAL_BASE_URL ?? 'http://127.0.0.1:3000';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** The user the token belongs to, whose chat_log rows hold the scores. */
function tokenSubject(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
  ) as { sub?: string };
  if (!payload.sub) {
    throw new Error('EVAL_TOKEN has no subject');
  }
  return payload.sub;
}

interface ApiReply {
  answer?: string;
  answered?: boolean;
  sources?: { section: string }[];
}

/** Asks one question, waiting out the rate limit rather than failing on it. */
async function ask(
  question: string,
  token: string,
): Promise<{ status: number; reply: ApiReply; latencyMs: number }> {
  for (;;) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}/assistant/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question }),
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after') ?? 60);
      console.error(`Rate limited: waiting ${seconds} s`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    return {
      status: response.status,
      reply: (await response.json()) as ApiReply,
      latencyMs: Date.now() - started,
    };
  }
}

/** The newest chat_log row for this question, with section headings. */
async function lastRow(
  db: pg.Client,
  userId: string,
  question: string,
): Promise<
  Pick<EvalObservation, 'retrieved' | 'promptTokens' | 'completionTokens'>
> {
  const { rows } = await db.query<{
    sections: { id: string; score: number }[];
    prompt_tokens: number | null;
    completion_tokens: number | null;
  }>(
    `SELECT sections, prompt_tokens, completion_tokens FROM chat_log
     WHERE user_id = $1 AND question = $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, question],
  );
  const row = rows[0];
  if (!row) {
    return { retrieved: [], promptTokens: null, completionTokens: null };
  }

  const { rows: chunks } = await db.query<{ id: string; section: string }>(
    `SELECT id, section FROM chunks WHERE id = ANY($1::uuid[])`,
    [row.sections.map(({ id }) => id)],
  );
  const headings = new Map(chunks.map(({ id, section }) => [id, section]));
  return {
    retrieved: row.sections.map(({ id, score }) => ({
      section: headings.get(id) ?? id,
      score,
    })),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
  };
}

async function main(): Promise<void> {
  const token = required('EVAL_TOKEN');
  const userId = tokenSubject(token);
  const questions = JSON.parse(
    await readFile(QUESTIONS_FILE, 'utf8'),
  ) as EvalQuestion[];

  const db = new pg.Client({
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    user: required('DB_USERNAME'),
    database: required('DB_DATABASE'),
    password: readDatabasePassword(required('DB_PASSWORD_FILE')),
  });
  await db.connect();

  try {
    const results = [];
    for (const [index, question] of questions.entries()) {
      console.error(`${index + 1}/${questions.length} ${question.id}`);
      const { status, reply, latencyMs } = await ask(question.question, token);
      results.push(
        scoreQuestion(question, {
          status,
          answered: reply.answered ?? false,
          answer: reply.answer ?? '',
          cited: (reply.sources ?? []).map(({ section }) => section),
          latencyMs,
          ...(await lastRow(db, userId, question.question)),
        }),
      );
    }

    const report = buildReport(results);
    console.log(renderReport(report, required('OPENROUTER_CHAT_MODEL')));
    process.exitCode = report.targetsMet ? 0 : 1;
  } finally {
    await db.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `Evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
