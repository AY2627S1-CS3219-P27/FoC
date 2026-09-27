import {
  FLOOR_PATTERN,
  buildingKey,
  displayName,
  nameKey,
  normaliseFloor,
} from './normalise.js';

describe('nameKey', () => {
  it('trims, collapses internal whitespace and case-folds', () => {
    expect(nameKey('  Cool   SPOT \t')).toBe('cool spot');
  });

  it('treats composed and decomposed Unicode as the same name', () => {
    const composed = 'Café';
    const decomposed = 'Café';
    expect(nameKey(composed)).toBe(nameKey(decomposed));
  });

  it('keeps punctuation, so different names stay different', () => {
    expect(nameKey('Cafe+')).not.toBe(nameKey('Cafe'));
  });
});

describe('buildingKey', () => {
  it('ignores case and all whitespace', () => {
    expect(buildingKey('Com 2')).toBe('com2');
    expect(buildingKey('COM2')).toBe('com2');
    expect(buildingKey(' Central  Library ')).toBe('centrallibrary');
  });

  it('keeps apostrophe variants distinct (aliases cover them)', () => {
    expect(buildingKey("Prince George's Park")).not.toBe(
      buildingKey('Prince George’s Park'),
    );
  });
});

describe('normaliseFloor', () => {
  it('upper-cases and trims', () => {
    expect(normaliseFloor(' b1 ')).toBe('B1');
    expect(normaliseFloor('m')).toBe('M');
  });
});

describe('FLOOR_PATTERN', () => {
  it.each(['B1', 'B9', '1', '9', '10', '99', 'M'])('accepts %s', (floor) => {
    expect(FLOOR_PATTERN.test(floor)).toBe(true);
  });

  it.each(['B0', 'B10', '0', '01', '100', 'b1', 'MM', '', 'G'])(
    'rejects %s',
    (floor) => {
      expect(FLOOR_PATTERN.test(floor)).toBe(false);
    },
  );
});

describe('displayName', () => {
  it('joins the name and building short name', () => {
    expect(displayName('Cool Spot', 'COM3')).toBe('Cool Spot @ COM3');
  });
});
