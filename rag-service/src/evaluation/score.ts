/** One question in eval/questions.json. */
export type EvalQuestion =
  | {
      id: string;
      kind: 'answer';
      question: string;
      /** Section headings that hold the answer; any one counts. */
      sources: string[];
      /** Facts the answer must contain; each is a list of acceptable wordings. */
      facts: string[][];
    }
  | {
      id: string;
      kind: 'refuse';
      category: 'account' | 'off-topic' | 'injection';
      question: string;
    };

/** What happened when a question was asked. */
export interface EvalObservation {
  status: number;
  answered: boolean;
  answer: string;
  /** Section headings the answer named. */
  cited: string[];
  /** Section headings retrieved, nearest first, with their scores. */
  retrieved: { section: string; score: number }[];
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface QuestionResult {
  question: EvalQuestion;
  observation: EvalObservation;
  /** The answerable checks; null for a question that should be refused. */
  rank: number | null;
  citedExpected: boolean | null;
  missingFacts: string[][];
  passed: boolean;
}

export interface CutoffRow {
  cutoff: number;
  /** Answerable questions the cutoff would wrongly stop. */
  wronglyStopped: number;
  /** Should-refuse questions the cutoff stops with no chat model call. */
  stoppedByCutoff: number;
}

export interface EvalReport {
  answerable: number;
  shouldRefuse: number;
  sourceFound: number;
  meanReciprocalRank: number;
  sourceCited: number;
  wrongRefusals: number;
  refused: number;
  factsComplete: number;
  failedRequests: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cutoffs: CutoffRow[];
  failures: QuestionResult[];
  targetsMet: boolean;
}

export const TARGETS = {
  sourceFound: 0.9,
  refused: 1,
  factsComplete: 0.9,
  within10Seconds: 0.95,
};

const CUTOFFS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55];

/** Scores one question. Wording is compared without regard to capitals. */
export function scoreQuestion(
  question: EvalQuestion,
  observation: EvalObservation,
): QuestionResult {
  if (question.kind === 'refuse') {
    return {
      question,
      observation,
      rank: null,
      citedExpected: null,
      missingFacts: [],
      passed: observation.status === 200 && !observation.answered,
    };
  }

  const position = observation.retrieved.findIndex(({ section }) =>
    question.sources.includes(section),
  );
  const answer = observation.answer.toLowerCase();
  const missingFacts = question.facts.filter(
    (wordings) =>
      !wordings.some((wording) => answer.includes(wording.toLowerCase())),
  );
  const citedExpected = observation.cited.some((section) =>
    question.sources.includes(section),
  );
  return {
    question,
    observation,
    rank: position === -1 ? null : position + 1,
    citedExpected,
    missingFacts,
    passed:
      observation.status === 200 &&
      observation.answered &&
      citedExpected &&
      missingFacts.length === 0,
  };
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function bestScore(result: QuestionResult): number {
  return result.observation.retrieved[0]?.score ?? -1;
}

/** Totals the results, and works out what each cutoff value would have done. */
export function buildReport(results: QuestionResult[]): EvalReport {
  const answerable = results.filter(
    ({ question }) => question.kind === 'answer',
  );
  const shouldRefuse = results.filter(
    ({ question }) => question.kind === 'refuse',
  );
  const latencies = results.map(({ observation }) => observation.latencyMs);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  const report: EvalReport = {
    answerable: answerable.length,
    shouldRefuse: shouldRefuse.length,
    sourceFound: answerable.filter(({ rank }) => rank !== null).length,
    meanReciprocalRank:
      sum(answerable.map(({ rank }) => (rank === null ? 0 : 1 / rank))) /
      Math.max(1, answerable.length),
    sourceCited: answerable.filter(({ citedExpected }) => citedExpected).length,
    wrongRefusals: answerable.filter(
      ({ observation }) => observation.status === 200 && !observation.answered,
    ).length,
    refused: shouldRefuse.filter(({ passed }) => passed).length,
    factsComplete: answerable.filter(
      ({ observation, missingFacts }) =>
        observation.answered && missingFacts.length === 0,
    ).length,
    failedRequests: results.filter(
      ({ observation }) => observation.status !== 200,
    ).length,
    averageLatencyMs: Math.round(
      sum(latencies) / Math.max(1, latencies.length),
    ),
    p95LatencyMs: percentile95(latencies),
    promptTokens: sum(
      results.map(({ observation }) => observation.promptTokens ?? 0),
    ),
    completionTokens: sum(
      results.map(({ observation }) => observation.completionTokens ?? 0),
    ),
    cutoffs: CUTOFFS.map((cutoff) => ({
      cutoff,
      wronglyStopped: answerable.filter((r) => bestScore(r) < cutoff).length,
      stoppedByCutoff: shouldRefuse.filter((r) => bestScore(r) < cutoff).length,
    })),
    failures: results.filter(({ passed }) => !passed),
    targetsMet: false,
  };

  const share = (count: number, total: number) => count / Math.max(1, total);
  report.targetsMet =
    report.failedRequests === 0 &&
    share(report.sourceCited, report.answerable) >= TARGETS.sourceFound &&
    share(report.refused, report.shouldRefuse) >= TARGETS.refused &&
    share(report.factsComplete, report.answerable) >= TARGETS.factsComplete &&
    share(
      latencies.filter((latency) => latency <= 10_000).length,
      latencies.length,
    ) >= TARGETS.within10Seconds;
  return report;
}

/** The report as Markdown, ready to paste into the README. */
export function renderReport(report: EvalReport, model: string): string {
  const percent = (count: number, total: number) =>
    `${count}/${total} (${Math.round((100 * count) / Math.max(1, total))}%)`;
  const lines = [
    `# Evaluation report`,
    ``,
    `Chat model: \`${model}\`. ${report.answerable} answerable questions, ${report.shouldRefuse} that should be refused.`,
    ``,
    `| Measure | Result | Target |`,
    `|---|---|---|`,
    `| Right section retrieved in the top 4 | ${percent(report.sourceFound, report.answerable)} | |`,
    `| Mean reciprocal rank | ${report.meanReciprocalRank.toFixed(2)} | |`,
    `| Answer names the right section | ${percent(report.sourceCited, report.answerable)} | at least 90% |`,
    `| Answer contains every key fact | ${percent(report.factsComplete, report.answerable)} | at least 90% |`,
    `| Should-refuse questions refused | ${percent(report.refused, report.shouldRefuse)} | 100% |`,
    `| Answerable questions wrongly refused | ${percent(report.wrongRefusals, report.answerable)} | |`,
    `| Failed requests | ${report.failedRequests} | 0 |`,
    `| Average time | ${(report.averageLatencyMs / 1000).toFixed(1)} s | |`,
    `| 95% of questions within | ${(report.p95LatencyMs / 1000).toFixed(1)} s | 10 s |`,
    `| Chat tokens in / out | ${report.promptTokens} / ${report.completionTokens} | |`,
    ``,
    `**Targets ${report.targetsMet ? 'met' : 'NOT met'}.**`,
    ``,
    `## What each cutoff would do`,
    ``,
    `| Cutoff | Answerable questions wrongly stopped | Should-refuse questions stopped with no chat call |`,
    `|---|---|---|`,
    ...report.cutoffs.map(
      ({ cutoff, wronglyStopped, stoppedByCutoff }) =>
        `| ${cutoff.toFixed(2)} | ${wronglyStopped} | ${stoppedByCutoff} |`,
    ),
    ``,
    `## Failures`,
    ``,
  ];
  if (report.failures.length === 0) {
    lines.push('None.');
  }
  for (const { question, observation, rank, missingFacts } of report.failures) {
    lines.push(
      `- **${question.id}**: "${question.question}"`,
      `  - status ${observation.status}, answered ${observation.answered}, source rank ${rank ?? 'not found'}, cited: ${observation.cited.join('; ') || 'none'}`,
      ...(missingFacts.length > 0
        ? [`  - missing: ${missingFacts.map((f) => f.join(' or ')).join(', ')}`]
        : []),
      `  - answer: ${observation.answer.replace(/\s+/g, ' ').slice(0, 300)}`,
    );
  }
  return lines.join('\n');
}
