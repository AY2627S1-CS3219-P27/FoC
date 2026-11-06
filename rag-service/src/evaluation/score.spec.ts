import { readFileSync } from 'node:fs';
import { chunkFolder } from '../indexing/chunker.js';
import {
  buildReport,
  type EvalObservation,
  type EvalQuestion,
  renderReport,
  scoreQuestion,
} from './score.js';

const answerable: EvalQuestion = {
  id: 'a',
  kind: 'answer',
  question: 'how?',
  sources: ['Right'],
  facts: [['24 hours', 'a day'], ['admin']],
};
const refusable: EvalQuestion = {
  id: 'r',
  kind: 'refuse',
  category: 'account',
  question: 'my balance?',
};

const observed = (extra: Partial<EvalObservation> = {}): EvalObservation => ({
  status: 200,
  answered: true,
  answer: 'Ask an Admin within 24 hours.',
  cited: ['Right'],
  retrieved: [
    { section: 'Right', score: 0.7 },
    { section: 'Other', score: 0.5 },
  ],
  latencyMs: 2000,
  promptTokens: 100,
  completionTokens: 10,
  ...extra,
});

describe('scoreQuestion', () => {
  it('passes an answer with the right source and every fact', () => {
    expect(scoreQuestion(answerable, observed())).toMatchObject({
      rank: 1,
      citedExpected: true,
      missingFacts: [],
      passed: true,
    });
  });

  it('accepts any listed wording, ignoring capitals', () => {
    const result = scoreQuestion(
      answerable,
      observed({ answer: 'an ADMIN, within A DAY' }),
    );

    expect(result.missingFacts).toEqual([]);
  });

  it('matches whole words only', () => {
    const noFact: EvalQuestion = {
      ...answerable,
      facts: [['no']],
    } as EvalQuestion;

    expect(
      scoreQuestion(noFact, observed({ answer: 'You do not know.' }))
        .missingFacts,
    ).toEqual([['no']]);
    expect(
      scoreQuestion(noFact, observed({ answer: 'No, you cannot.' }))
        .missingFacts,
    ).toEqual([]);
  });

  it('reports the rank of a section found lower down', () => {
    const result = scoreQuestion(
      answerable,
      observed({
        retrieved: [
          { section: 'Other', score: 0.8 },
          { section: 'Right', score: 0.6 },
        ],
      }),
    );

    expect(result.rank).toBe(2);
  });

  it.each([
    ['a missing fact', { answer: 'Within 24 hours.' }],
    ['the wrong section named', { cited: ['Other'] }],
    ['a refusal', { answered: false }],
    ['a failed request', { status: 503 }],
  ])('fails an answer with %s', (_case, extra) => {
    expect(scoreQuestion(answerable, observed(extra)).passed).toBe(false);
  });

  it('passes a should-refuse question only when refused', () => {
    expect(scoreQuestion(refusable, observed({ answered: false })).passed).toBe(
      true,
    );
    expect(scoreQuestion(refusable, observed()).passed).toBe(false);
  });

  it('does not count a failed request as a refusal', () => {
    expect(
      scoreQuestion(refusable, observed({ answered: false, status: 503 }))
        .passed,
    ).toBe(false);
  });
});

describe('buildReport', () => {
  it('meets the targets when everything passes', () => {
    const report = buildReport([
      scoreQuestion(answerable, observed()),
      scoreQuestion(refusable, observed({ answered: false })),
    ]);

    expect(report).toMatchObject({
      answerable: 1,
      shouldRefuse: 1,
      sourceFound: 1,
      meanReciprocalRank: 1,
      refused: 1,
      factsComplete: 1,
      targetsMet: true,
      failures: [],
    });
  });

  it('misses the targets when one should-refuse question is answered', () => {
    const report = buildReport([
      scoreQuestion(answerable, observed()),
      scoreQuestion(refusable, observed()),
    ]);

    expect(report.targetsMet).toBe(false);
    expect(report.failures.map(({ question }) => question.id)).toEqual(['r']);
  });

  it('misses the targets when requests fail or are slow', () => {
    expect(
      buildReport([
        scoreQuestion(answerable, observed({ status: 503, answered: false })),
      ]).targetsMet,
    ).toBe(false);
    expect(
      buildReport([scoreQuestion(answerable, observed({ latencyMs: 12_000 }))])
        .targetsMet,
    ).toBe(false);
  });

  it('works out what each cutoff would have done', () => {
    const report = buildReport([
      scoreQuestion(answerable, observed()),
      scoreQuestion(
        refusable,
        observed({
          answered: false,
          retrieved: [{ section: 'Far', score: 0.27 }],
        }),
      ),
    ]);

    expect(report.cutoffs.find(({ cutoff }) => cutoff === 0.25)).toEqual({
      cutoff: 0.25,
      wronglyStopped: 0,
      stoppedByCutoff: 0,
    });
    expect(report.cutoffs.find(({ cutoff }) => cutoff === 0.3)).toEqual({
      cutoff: 0.3,
      wronglyStopped: 0,
      stoppedByCutoff: 1,
    });
  });

  it('counts tokens and timing', () => {
    const report = buildReport([
      scoreQuestion(answerable, observed({ latencyMs: 1000 })),
      scoreQuestion(answerable, observed({ latencyMs: 3000 })),
    ]);

    expect(report).toMatchObject({
      averageLatencyMs: 2000,
      p95LatencyMs: 3000,
      promptTokens: 200,
      completionTokens: 20,
    });
  });
});

describe('renderReport', () => {
  it('names each failure and what went wrong', () => {
    const text = renderReport(
      buildReport([
        scoreQuestion(answerable, observed({ answer: 'Within 24 hours.' })),
      ]),
      'test/model',
    );

    expect(text).toContain('test/model');
    expect(text).toContain('Targets NOT met');
    expect(text).toContain('missing: admin');
  });

  it('includes every answer, so a person can read them', () => {
    const text = renderReport(
      buildReport([scoreQuestion(answerable, observed())]),
      'test/model',
    );

    expect(text).toContain('## All answers');
    expect(text).toContain('Ask an Admin within 24 hours.');
  });
});

describe('eval/questions.json', () => {
  const questions = JSON.parse(
    readFileSync(new URL('../../eval/questions.json', import.meta.url), 'utf8'),
  ) as EvalQuestion[];

  it('has a unique id for each question', () => {
    const ids = questions.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers answerable, account, off-topic and injection questions', () => {
    const categories = new Set(
      questions.map((q) => (q.kind === 'refuse' ? q.category : q.kind)),
    );

    expect(categories).toEqual(
      new Set(['answer', 'account', 'off-topic', 'injection']),
    );
    expect(questions.length).toBeGreaterThanOrEqual(20);
  });

  it('keeps every question within the 500-character limit', () => {
    for (const { question } of questions) {
      expect(question.length).toBeLessThanOrEqual(500);
    }
  });

  // A renamed heading would otherwise make a question fail for the wrong reason.
  it('expects only section headings that exist in docs/support/', async () => {
    const chunks = await chunkFolder(
      new URL('../../../docs/support', import.meta.url).pathname,
    );
    const headings = new Set(chunks.map(({ section }) => section));

    for (const question of questions) {
      if (question.kind === 'answer') {
        expect(
          question.sources.filter((source) => !headings.has(source)),
          question.id,
        ).toEqual([]);
      }
    }
  });
});
