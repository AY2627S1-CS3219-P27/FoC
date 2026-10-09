import 'reflect-metadata';
import { SupplierKind } from '../database/entities/index.js';
import { type CampusBox, checkSupplierInput } from './supplier-input.rules.js';

const CAMPUS: CampusBox = {
  minLatitude: 1.28,
  maxLatitude: 1.31,
  minLongitude: 103.74,
  maxLongitude: 103.79,
};

const VALID = {
  name: '  Cool Spot  ',
  kind: SupplierKind.Store,
  categoryIds: ['0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11'],
  buildingId: '6f1c2e0a-8d4b-4d3e-b1a2-9c8d7e6f5a41',
  floor: ' b1 ',
  locationDescription: ' Next to LT19 ',
  coordinates: { latitude: 1.2951, longitude: 103.7737 },
  photoUrl: 'https://example.com/cool-spot.jpg',
};

function fields(result: Awaited<ReturnType<typeof checkSupplierInput>>) {
  if (result.valid) {
    throw new Error('expected the input to be rejected');
  }
  return result.violations.map((violation) => violation.field);
}

describe('checkSupplierInput', () => {
  it('accepts a valid supplier and normalises its text', async () => {
    const result = await checkSupplierInput(VALID, CAMPUS);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toMatchObject({
        name: 'Cool Spot',
        floor: 'B1',
        locationDescription: 'Next to LT19',
      });
    }
  });

  it('treats the photo as optional', async () => {
    const { photoUrl: _photo, ...withoutPhoto } = VALID;
    expect((await checkSupplierInput(withoutPhoto, CAMPUS)).valid).toBe(true);
    expect(
      (await checkSupplierInput({ ...VALID, photoUrl: null }, CAMPUS)).valid,
    ).toBe(true);
  });

  it('lists every broken rule at once, not only the first (F1.6.1)', async () => {
    const result = await checkSupplierInput(
      {
        ...VALID,
        name: '   ',
        kind: 'Shop',
        categoryIds: [],
        buildingId: 'COM3',
        floor: '0',
        locationDescription: '',
        photoUrl: 'not a url',
      },
      CAMPUS,
    );

    expect(fields(result)).toEqual(
      expect.arrayContaining([
        'name',
        'kind',
        'categoryIds',
        'buildingId',
        'floor',
        'locationDescription',
        'photoUrl',
      ]),
    );
  });

  it('rejects duplicate category ids (F1.2.3)', async () => {
    const id = VALID.categoryIds[0];
    const result = await checkSupplierInput(
      { ...VALID, categoryIds: [id, id] },
      CAMPUS,
    );
    expect(fields(result)).toEqual(['categoryIds']);
  });

  it('rejects system-managed and unknown fields (F1.3.2, F1.6)', async () => {
    const result = await checkSupplierInput(
      { ...VALID, id: 'x', version: 2, status: 'Active', flor: '1' },
      CAMPUS,
    );
    expect(fields(result)).toEqual(
      expect.arrayContaining(['id', 'version', 'status', 'flor']),
    );
  });

  it('rejects coordinates outside the campus box (F1.2.7)', async () => {
    const result = await checkSupplierInput(
      { ...VALID, coordinates: { latitude: 1.35, longitude: 103.9 } },
      CAMPUS,
    );
    expect(fields(result)).toEqual([
      'coordinates.latitude',
      'coordinates.longitude',
    ]);
  });

  it('accepts the westernmost seed supplier (Cheers)', async () => {
    const result = await checkSupplierInput(
      { ...VALID, coordinates: { latitude: 1.2991, longitude: 103.7526298 } },
      CAMPUS,
    );
    expect(result.valid).toBe(true);
  });

  it('reports missing or malformed coordinates without a campus error', async () => {
    const { coordinates: _c, ...withoutCoordinates } = VALID;
    expect(
      fields(await checkSupplierInput(withoutCoordinates, CAMPUS)),
    ).toEqual(['coordinates']);

    // One violation per broken rule (not a number, below min, above max), all
    // on the one field, and no campus-box violation on top.
    const malformed = fields(
      await checkSupplierInput(
        { ...VALID, coordinates: { latitude: 'north', longitude: 103.77 } },
        CAMPUS,
      ),
    );
    expect(new Set(malformed)).toEqual(new Set(['coordinates.latitude']));
  });

  it('rejects a body that is not an object', async () => {
    expect(fields(await checkSupplierInput(['Cool Spot'], CAMPUS))).toEqual([
      '',
    ]);
  });
});
