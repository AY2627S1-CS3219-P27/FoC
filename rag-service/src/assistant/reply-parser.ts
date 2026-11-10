import { NO_ANSWER_MARKER } from './prompt-builder.js';

export type ParsedReply =
  /** Nothing usable came back. */
  | { kind: 'empty' }
  /** The model declined, as its rules tell it to. */
  | { kind: 'no-answer' }
  /** An answer, and the positions (from 0) of the sections it used. */
  | { kind: 'answer'; answer: string; sectionIndexes: number[] };

const SOURCES_LINE = /^\s*SOURCES\s*:(.*)$/gim;

/**
 * Reads the model's reply. Any reply mentioning the marker counts as declined,
 * because a half-refusal is not an answer to show. Every answer must name its
 * sources, so one with no usable SOURCES line lists all the sections sent;
 * numbers outside those sections are ignored.
 */
export function parseReply(raw: string, sectionCount: number): ParsedReply {
  if (raw.includes(NO_ANSWER_MARKER)) {
    return { kind: 'no-answer' };
  }

  const wanted = new Set<number>();
  for (const [, numbers] of raw.matchAll(SOURCES_LINE)) {
    for (const number of numbers.split(',')) {
      const position = Number(number.trim());
      if (
        Number.isInteger(position) &&
        position >= 1 &&
        position <= sectionCount
      ) {
        wanted.add(position - 1);
      }
    }
  }

  const answer = raw.replace(SOURCES_LINE, '').trim();
  if (answer.length === 0) {
    return { kind: 'empty' };
  }
  return {
    kind: 'answer',
    answer,
    sectionIndexes:
      wanted.size > 0
        ? [...wanted].sort((a, b) => a - b)
        : Array.from({ length: sectionCount }, (_, index) => index),
  };
}
