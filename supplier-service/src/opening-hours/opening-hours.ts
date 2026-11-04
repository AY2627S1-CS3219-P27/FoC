import type { FieldViolation } from '../common/errors/error-response.js';

/**
 * Weekly opening hours (F2): pure rules and calculations with no database.
 *
 * Times are 24-hour HH:MM, read in Singapore time (F2.1.1). An interval whose
 * closing time is earlier than its opening time is overnight: it belongs to
 * the day it opens and runs into the next day (F2.3). A day without
 * intervals is closed (F2.1.2).
 */

/** Monday first, matching the day numbers stored in the database (0-6). */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAYS)[number];

export interface Interval {
  opens: string;
  closes: string;
}

/**
 * The API form of opening hours: open around the clock (F2.2), or weekly
 * intervals per day. The two are mutually exclusive.
 */
export type OpeningHours =
  { open24Hours: true } | { days: Partial<Record<DayKey, Interval[]>> };

/** One stored interval: the day (0 = Monday) and minutes since midnight. */
export interface IntervalRow {
  day: number;
  opensAt: number;
  closesAt: number;
}

export type OpeningHoursCheck =
  | { valid: true; value: OpeningHours }
  | { valid: false; violations: FieldViolation[] };

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
/** A sanity bound per day; the requirements set none. */
export const MAX_INTERVALS_PER_DAY = 10;
export const OPENING_HOURS_TIME_ZONE = 'Asia/Singapore';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight for a valid HH:MM, else null (F2.4.1). */
export function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = TIME_PATTERN.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The length of an interval in minutes; overnight intervals wrap midnight. */
function lengthOf(opensAt: number, closesAt: number): number {
  return closesAt > opensAt
    ? closesAt - opensAt
    : MINUTES_PER_DAY - opensAt + closesAt;
}

/**
 * Checks raw opening hours against F2.1-F2.4 and returns them in canonical
 * form: days in week order, intervals sorted, closed days left out. Every
 * problem is reported with its path (F1.6.1). An empty schedule is refused:
 * "no opening hours" is the field being absent, or null to remove it.
 */
export function checkOpeningHours(raw: unknown): OpeningHoursCheck {
  const violations: FieldViolation[] = [];
  const fail = (field: string, reason: string) =>
    violations.push({ field: `openingHours${field}`, reason });

  if (!isPlainObject(raw)) {
    fail('', 'openingHours must be an object, or null to remove it');
    return { valid: false, violations };
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'open24Hours' && key !== 'days') {
      fail(`.${key}`, 'unknown field; use open24Hours or days');
    }
  }
  const hasOpen24 = 'open24Hours' in raw;
  const hasDays = 'days' in raw;
  if (hasOpen24 && hasDays) {
    fail('', 'open24Hours and days cannot be combined (F2.2)');
  }
  if (!hasOpen24 && !hasDays && violations.length === 0) {
    fail('', 'give open24Hours: true, or days with at least one interval');
  }
  if (hasOpen24 && raw.open24Hours !== true) {
    fail('.open24Hours', 'open24Hours must be true; omit it to give no hours');
  }
  if (violations.length > 0) {
    return { valid: false, violations };
  }
  if (hasOpen24) {
    return { valid: true, value: { open24Hours: true } };
  }

  const days = raw.days;
  if (!isPlainObject(days)) {
    fail(
      '.days',
      'days must be an object keyed by mon, tue, wed, thu, fri, sat, sun',
    );
    return { valid: false, violations };
  }
  for (const key of Object.keys(days)) {
    if (!(DAYS as readonly string[]).includes(key)) {
      fail(
        `.days.${key}`,
        'unknown day; use mon, tue, wed, thu, fri, sat, sun',
      );
    }
  }

  const canonical: Partial<Record<DayKey, Interval[]>> = {};
  const rows: (IntervalRow & { path: string })[] = [];
  for (const [dayIndex, day] of DAYS.entries()) {
    const list = days[day];
    if (list === undefined) {
      continue;
    }
    if (!Array.isArray(list)) {
      fail(`.days.${day}`, 'must be a list of intervals (empty for closed)');
      continue;
    }
    if (list.length > MAX_INTERVALS_PER_DAY) {
      fail(
        `.days.${day}`,
        `at most ${MAX_INTERVALS_PER_DAY} intervals per day`,
      );
      continue;
    }
    for (const [i, item] of list.entries()) {
      const path = `.days.${day}[${i}]`;
      if (!isPlainObject(item)) {
        fail(path, 'must be an object with opens and closes');
        continue;
      }
      for (const key of Object.keys(item)) {
        if (key !== 'opens' && key !== 'closes') {
          fail(`${path}.${key}`, 'unknown field; use opens and closes');
        }
      }
      const opensAt = parseTime(item.opens);
      const closesAt = parseTime(item.closes);
      if (opensAt === null) {
        fail(`${path}.opens`, 'opens must be a time in HH:MM (00:00-23:59)');
      }
      if (closesAt === null) {
        fail(`${path}.closes`, 'closes must be a time in HH:MM (00:00-23:59)');
      }
      if (opensAt === null || closesAt === null) {
        continue;
      }
      if (opensAt === closesAt) {
        fail(path, 'opens and closes must differ (F2.4)');
        continue;
      }
      rows.push({ day: dayIndex, opensAt, closesAt, path });
    }
  }
  if (violations.length > 0) {
    return { valid: false, violations };
  }
  if (rows.length === 0) {
    fail('.days', 'at least one interval is required (F2.4)');
    return { valid: false, violations };
  }

  for (const [a, b] of overlappingPairs(rows)) {
    fail(
      b.path,
      `overlaps ${a.path.slice('.days.'.length)}, including an overnight interval (F2.4)`,
    );
  }
  if (violations.length > 0) {
    return { valid: false, violations };
  }

  for (const row of rows.toSorted(
    (a, b) => a.day - b.day || a.opensAt - b.opensAt,
  )) {
    const day = DAYS[row.day]!;
    (canonical[day] ??= []).push({
      opens: formatTime(row.opensAt),
      closes: formatTime(row.closesAt),
    });
  }
  return { valid: true, value: { days: canonical } };
}

/** The week as a circle of minutes: an interval is [start, start + length). */
function weekRanges(rows: IntervalRow[]): { start: number; end: number }[] {
  return rows.flatMap((row) => {
    const start = row.day * MINUTES_PER_DAY + row.opensAt;
    const end = start + lengthOf(row.opensAt, row.closesAt);
    // An interval running past Sunday midnight continues from Monday.
    return end > MINUTES_PER_WEEK
      ? [
          { start, end: MINUTES_PER_WEEK },
          { start: 0, end: end - MINUTES_PER_WEEK },
        ]
      : [{ start, end }];
  });
}

/** Pairs of intervals that share any minute; touching ends do not overlap. */
function overlappingPairs<T extends IntervalRow>(rows: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      const hit = weekRanges([a]).some((x) =>
        weekRanges([b]).some((y) => x.start < y.end && y.start < x.end),
      );
      if (hit) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/** The rows and flag to store for opening hours (F2.1, F2.2). */
export function toRows(hours: OpeningHours): {
  open24Hours: boolean;
  intervals: IntervalRow[];
} {
  if ('open24Hours' in hours) {
    return { open24Hours: true, intervals: [] };
  }
  const intervals: IntervalRow[] = [];
  for (const [day, key] of DAYS.entries()) {
    for (const interval of hours.days[key] ?? []) {
      intervals.push({
        day,
        opensAt: parseTime(interval.opens)!,
        closesAt: parseTime(interval.closes)!,
      });
    }
  }
  return { open24Hours: false, intervals };
}

/** The API form of stored hours; null when the supplier has none (F1.2.8). */
export function fromRows(
  open24Hours: boolean,
  intervals: IntervalRow[],
): OpeningHours | null {
  if (open24Hours) {
    return { open24Hours: true };
  }
  if (intervals.length === 0) {
    return null;
  }
  const days: Partial<Record<DayKey, Interval[]>> = {};
  for (const row of intervals.toSorted(
    (a, b) => a.day - b.day || a.opensAt - b.opensAt,
  )) {
    (days[DAYS[row.day]!] ??= []).push({
      opens: formatTime(row.opensAt),
      closes: formatTime(row.closesAt),
    });
  }
  return { days };
}

export interface OpenStatus {
  /** Null where the supplier has no opening hours (F2.5.1). */
  isOpenNow: boolean | null;
  /** The next opening or closing; null if it never changes or is not applicable. */
  nextChangeAt: Date | null;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPENING_HOURS_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The minute of the Singapore week (Monday 00:00 = 0) for an instant. */
export function singaporeWeekMinute(now: Date): number {
  const parts = Object.fromEntries(
    clockFormat.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return (
    WEEKDAY_INDEX[parts.weekday!]! * MINUTES_PER_DAY +
    Number(parts.hour) * 60 +
    Number(parts.minute)
  );
}

/**
 * Whether the supplier is open at `now`, and when that next changes (F2.5).
 * Adjacent intervals count as one, so closing at 12:00 and reopening at
 * 12:00 is not a change. Hours are informational only (F2.7).
 */
export function openStatus(
  intervals: IntervalRow[],
  open24Hours: boolean,
  now: Date,
): OpenStatus {
  if (open24Hours) {
    return { isOpenNow: true, nextChangeAt: null };
  }
  if (intervals.length === 0) {
    return { isOpenNow: null, nextChangeAt: null };
  }

  const week = singaporeWeekMinute(now);
  // The previous, this and next week, so wrap-around needs no special cases.
  const ranges = weekRanges(intervals)
    .flatMap((r) =>
      [-1, 0, 1].map((k) => ({
        start: r.start + k * MINUTES_PER_WEEK,
        end: r.end + k * MINUTES_PER_WEEK,
      })),
    )
    .toSorted((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  // Into the current minute: the change happens on a minute boundary.
  const intoMinuteMs = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const at = (minutes: number) =>
    new Date(now.getTime() - intoMinuteMs + (minutes - week) * 60_000);

  const current = merged.find((r) => r.start <= week && week < r.end);
  if (current !== undefined) {
    // Open around the clock through the whole week: it never changes.
    return current.end - current.start >= MINUTES_PER_WEEK
      ? { isOpenNow: true, nextChangeAt: null }
      : { isOpenNow: true, nextChangeAt: at(current.end) };
  }
  const next = merged.find((r) => r.start > week);
  return { isOpenNow: false, nextChangeAt: next ? at(next.start) : null };
}
