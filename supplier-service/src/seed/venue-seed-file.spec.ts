import { readFileSync } from 'node:fs';
import { parseVenueSeed } from './venue-seed-file.js';

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

const BUILDING = {
  shortName: 'COM1',
  canonicalName: 'Computing 1',
  aliases: [],
  latitude: 1.2948,
  longitude: 103.774,
};
const VENUE = {
  buildingShortName: 'COM1',
  code: 'COM1-0201',
  name: null,
  floor: '2',
  latitude: 1.2949,
  longitude: 103.7741,
  needsReview: false,
};
const file = (venue: object = {}) => ({
  buildings: [BUILDING],
  venues: [{ ...VENUE, ...venue }],
});

describe('parseVenueSeed', () => {
  it('reads buildings and venues, ignoring extra columns', () => {
    const parsed = parseVenueSeed(
      bytes({
        buildings: [{ ...BUILDING, venueCount: 1, nameSource: 'rules' }],
        venues: [{ ...VENUE, coordinateSource: 'source' }],
      }),
    );

    expect(parsed.buildings).toHaveLength(1);
    expect(parsed.venues[0]).toMatchObject({ code: 'COM1-0201', name: null });
  });

  it.each([
    ['not JSON', Buffer.from('{ nope')],
    ['no venues key', bytes({ buildings: [BUILDING] })],
    ['an empty building list', bytes({ buildings: [], venues: [] })],
    ['a bad floor', bytes(file({ floor: '03' }))],
    ['a latitude out of range', bytes(file({ latitude: 91 }))],
    ['an empty code', bytes(file({ code: ' ' }))],
    ['a missing review flag', bytes(file({ needsReview: undefined }))],
    ['an unknown building', bytes(file({ buildingShortName: 'NOPE' }))],
    [
      'a repeated code in one building',
      bytes({ buildings: [BUILDING], venues: [VENUE, VENUE] }),
    ],
  ])('rejects %s', (_, input) => {
    expect(() => parseVenueSeed(input)).toThrow(/Venue seed file/);
  });
});

describe('data/json/venues-seed.json', () => {
  const seed = parseVenueSeed(readFileSync('../data/json/venues-seed.json'));

  it('is well formed, with no row flagged for review', () => {
    expect(seed.buildings.length).toBeGreaterThan(0);
    expect(seed.venues.filter((venue) => venue.needsReview)).toEqual([]);
  });

  it('gives every building a venue or a supplier, and drops the lecture theatres', () => {
    const shortNames = seed.buildings.map((b) => b.shortName);
    expect(shortNames).not.toContain('LT35');
    expect(seed.venues.map((v) => v.code)).not.toContain('LT37-03-07A');
    // The supplier CSV places suppliers in these, though they have no venues.
    expect(shortNames).toEqual(
      expect.arrayContaining(['PGP', 'The Ridge', 'YIH', 'Frontier']),
    );
  });

  it('renames AS8 but still answers to the seed CSV spelling', () => {
    expect(seed.buildings.find((b) => b.shortName === 'AS8')).toMatchObject({
      canonicalName: 'Arts and Social Sciences 8',
      aliases: ['Blk AS8'],
    });
  });
});
