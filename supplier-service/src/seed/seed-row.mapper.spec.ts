import { buildingKey } from '../common/normalise/normalise.js';
import { SEED_BUILDINGS, seedKind } from './reference-data.js';
import {
  categoryNamesOf,
  seedHoursViolations,
  seedOpeningHours,
  seedSupplierName,
  splitBuildingSuffix,
  toSupplierInput,
} from './seed-row.mapper.js';

const ROW = {
  Name: 'Cool Spot',
  Type: 'Food',
  Building: 'Com2',
  Floor: '1',
  'Location Description': 'Opp LT16',
  Latitude: '1.2940156',
  Longitude: '103.7738478',
  StartingTime: '0900hrs',
  ClosingTime: '2130hrs',
  ImageURL: 'https://example.com/COOL_SPOT.jpeg',
};

describe('categoryNamesOf', () => {
  it('splits "Food/Coffee" into two categories (F12.2.2)', () => {
    expect(categoryNamesOf('Food/Coffee')).toEqual(['Food', 'Coffee']);
  });

  it('drops blanks and case-insensitive repeats', () => {
    expect(categoryNamesOf(' Food / /food/ Coffee ')).toEqual([
      'Food',
      'Coffee',
    ]);
    expect(categoryNamesOf('')).toEqual([]);
  });
});

describe('splitBuildingSuffix', () => {
  it('splits a trailing "@ <building>"', () => {
    expect(splitBuildingSuffix('Printer @ Com 2')).toEqual({
      base: 'Printer',
      suffix: 'Com 2',
    });
    expect(splitBuildingSuffix('Central Square @ YIH')).toEqual({
      base: 'Central Square',
      suffix: 'YIH',
    });
  });

  it('leaves names without a usable suffix alone', () => {
    expect(splitBuildingSuffix('Cool Spot')).toBeNull();
    expect(splitBuildingSuffix('@ COM2')).toBeNull();
    expect(splitBuildingSuffix('Cool Spot @ ')).toBeNull();
  });
});

describe('seed configuration', () => {
  it('marks the Com 2 printer a Facility and defaults to Store (F12.2.5)', () => {
    expect(seedKind('Printer @ Com 2')).toBe('Facility');
    expect(seedKind('Cool Spot')).toBe('Store');
    expect(seedKind('')).toBe('Store');
  });

  it('renames the Terrace outlets so they stay distinct in COM3', () => {
    expect(seedSupplierName('InstaChef', 'InstaChef')).toBe(
      'InstaChef (Terrace)',
    );
    expect(seedSupplierName('Smooy', 'Smooy')).toBe('Smooy (Terrace)');
    expect(seedSupplierName('Printer @ Com 2', 'Printer')).toBe('Printer');
  });

  it('has aliases covering every building spelling in the seed file (F12.2.1)', () => {
    const known = new Set(
      SEED_BUILDINGS.flatMap((building) =>
        [building.canonicalName, building.shortName, ...building.aliases].map(
          buildingKey,
        ),
      ),
    );
    const seedSpellings = [
      'Central Library',
      'Com 2',
      'Com2',
      'Terrace',
      'COM3',
      "Prince George's Park",
      'Prince George’s Park',
      'Engineering Block E4',
      'The Ridge',
      'Yusof Ishak House',
      'Frontier',
      'Hon Sui Sen Memorial Library',
      'Engineering Block E3',
      'innovation4.0',
      'Medicine+Science Library',
      'Blk AS8',
      'Engineering Block EA',
      'YIH',
    ];
    expect(
      seedSpellings.filter((name) => !known.has(buildingKey(name))),
    ).toEqual([]);
  });

  it('gives no two seed buildings a shared name (F4.2)', () => {
    const keys = SEED_BUILDINGS.flatMap((building) => [
      ...new Set(
        [building.canonicalName, building.shortName, ...building.aliases].map(
          buildingKey,
        ),
      ),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('toSupplierInput', () => {
  it('maps the seed columns onto a supplier submission (F12.2.4)', () => {
    expect(
      toSupplierInput(ROW, {
        name: 'Cool Spot',
        buildingId: 'b-com2',
        categoryIds: ['c-food'],
      }),
    ).toEqual({
      name: 'Cool Spot',
      kind: 'Store',
      categoryIds: ['c-food'],
      buildingId: 'b-com2',
      floor: '1',
      locationDescription: 'Opp LT16',
      coordinates: { latitude: 1.2940156, longitude: 103.7738478 },
      photoUrl: 'https://example.com/COOL_SPOT.jpeg',
      openingHours: {
        days: Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
            day,
            [{ opens: '09:00', closes: '21:30' }],
          ]),
        ),
      },
    });
  });

  it('leaves out the opening hours when the times are blank or unreadable', () => {
    for (const times of [
      { StartingTime: '', ClosingTime: '' },
      { StartingTime: 'late', ClosingTime: '2130hrs' },
    ]) {
      expect(
        toSupplierInput(
          { ...ROW, ...times },
          { name: 'A', buildingId: 'b', categoryIds: [] },
        ),
      ).not.toHaveProperty('openingHours');
    }
  });

  it('omits the photo when the cell is empty, and keeps bad numbers as text', () => {
    const input = toSupplierInput(
      { ...ROW, ImageURL: '', Latitude: 'north' },
      { name: 'Cool Spot', buildingId: 'b', categoryIds: [] },
    );
    expect(input).not.toHaveProperty('photoUrl');
    expect(input.coordinates).toEqual({
      latitude: 'north',
      longitude: 103.7738478,
    });
  });
});

describe('seedOpeningHours (F12.2.3)', () => {
  const hours = (StartingTime: string, ClosingTime: string) =>
    seedOpeningHours({ StartingTime, ClosingTime });

  it('maps 0000hrs to 2359hrs to open 24 hours (F2.2)', () => {
    expect(hours('0000hrs', '2359hrs')).toEqual({ open24Hours: true });
  });

  it('applies the same interval to all seven days', () => {
    const result = hours('0815hrs', '1800hrs');

    expect(result).toEqual({
      days: {
        mon: [{ opens: '08:15', closes: '18:00' }],
        tue: [{ opens: '08:15', closes: '18:00' }],
        wed: [{ opens: '08:15', closes: '18:00' }],
        thu: [{ opens: '08:15', closes: '18:00' }],
        fri: [{ opens: '08:15', closes: '18:00' }],
        sat: [{ opens: '08:15', closes: '18:00' }],
        sun: [{ opens: '08:15', closes: '18:00' }],
      },
    });
  });

  it('keeps an overnight interval as it is (F2.3)', () => {
    expect(hours('1100hrs', '0200hrs')).toMatchObject({
      days: { mon: [{ opens: '11:00', closes: '02:00' }] },
    });
  });

  it('does not treat 0000hrs to 2358hrs, or 0001hrs to 2359hrs, as around the clock', () => {
    expect(hours('0000hrs', '2358hrs')).toHaveProperty('days');
    expect(hours('0001hrs', '2359hrs')).toHaveProperty('days');
  });

  it.each([
    ['blank cells', '', ''],
    ['one blank cell', '0900hrs', ''],
    ['an unreadable cell', 'noon', '1800hrs'],
    ['equal times', '0900hrs', '0900hrs'],
    ['an hour past 23', '2400hrs', '1800hrs'],
  ])('gives none for %s', (_, start, close) => {
    expect(hours(start, close)).toBeNull();
  });
});

describe('seedHoursViolations (F12.4)', () => {
  const problems = (StartingTime: string, ClosingTime: string) =>
    seedHoursViolations({ StartingTime, ClosingTime });

  it('finds nothing wrong with readable times, or with both cells blank (F1.2.8)', () => {
    expect(problems('0900hrs', '1800hrs')).toEqual([]);
    expect(problems('', '')).toEqual([]);
    expect(problems('1100hrs', '0200hrs')).toEqual([]);
  });

  it('names the cell that is missing or unreadable', () => {
    expect(problems('0900hrs', '')).toEqual([
      { field: 'ClosingTime', reason: expect.stringContaining('both') },
    ]);
    expect(problems('9am', '1800hrs')).toEqual([
      { field: 'StartingTime', reason: '"9am" is not a time like 0900hrs' },
    ]);
    expect(problems('2460hrs', 'late')).toHaveLength(2);
  });

  it('refuses equal times, naming ClosingTime', () => {
    expect(problems('0900hrs', '0900hrs')).toEqual([
      { field: 'ClosingTime', reason: expect.stringContaining('differ') },
    ]);
  });
});
