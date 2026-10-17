import { backoffDelay } from './backoff.js';

const base = { baseMs: 100, maxMs: 1000 };
const at = (attempt: number, random: number) =>
  backoffDelay(attempt, { ...base, random: () => random });

describe('backoffDelay', () => {
  it('waits up to baseMs before the first retry', () => {
    expect(at(1, 0.5)).toBe(50);
  });

  it('never waits less than 0', () => {
    expect(at(1, 0)).toBe(0);
    expect(at(10, 0)).toBe(0);
  });

  it('doubles the ceiling with each retry', () => {
    const almostOne = 1 - Number.EPSILON;
    expect([1, 2, 3, 4].map((a) => at(a, almostOne))).toEqual([
      100, 200, 400, 800,
    ]);
  });

  it('never goes past the cap, even for a huge attempt', () => {
    expect(at(5, 0.999)).toBe(999); // 1600 capped to 1000
    expect(at(2000, 0.5)).toBe(500); // 2 ** 1999 is Infinity, still capped
  });

  it('returns a whole number of milliseconds', () => {
    expect(Number.isInteger(at(3, 0.123456))).toBe(true);
  });

  it('uses Math.random when no random is given', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(backoffDelay(1, base)).toBe(50);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['attempt 0', 0, base],
    ['a negative attempt', -1, base],
    ['a fractional attempt', 2.5, base],
    ['a NaN attempt', NaN, base],
    ['a zero baseMs', 1, { baseMs: 0, maxMs: 1000 }],
    ['a negative baseMs', 1, { baseMs: -5, maxMs: 1000 }],
    ['a NaN baseMs', 1, { baseMs: NaN, maxMs: 1000 }],
    ['maxMs below baseMs', 1, { baseMs: 100, maxMs: 50 }],
    ['a NaN maxMs', 1, { baseMs: 100, maxMs: NaN }],
  ])('refuses %s', (_, attempt, options) => {
    expect(() => backoffDelay(attempt, options)).toThrow();
  });
});
