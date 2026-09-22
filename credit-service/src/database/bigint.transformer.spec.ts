import { bigintTransformer } from './bigint.transformer.js';

describe('bigintTransformer', () => {
  it('round-trips JavaScript-safe integers', () => {
    expect(bigintTransformer.to(100)).toBe('100');
    expect(bigintTransformer.from('100')).toBe(100);
  });

  it('rejects unsafe values on write and read', () => {
    expect(() => bigintTransformer.to(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
    expect(() => bigintTransformer.from('9007199254740992')).toThrow(
      RangeError,
    );
  });
});
