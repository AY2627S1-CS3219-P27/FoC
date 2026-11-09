import {
  type Brand,
  type Building,
  type Category,
  RequestState,
  RequestType,
  type Supplier,
  SupplierKind,
  SupplierRequest,
  SupplierStatus,
} from '../database/entities/index.js';
import {
  brandSnapshot,
  buildingSnapshot,
  categorySnapshot,
  requestSnapshot,
  supplierSnapshot,
} from './snapshots.js';

const supplier = {
  id: 's1',
  name: 'Cool Spot',
  kind: SupplierKind.Store,
  buildingId: 'b1',
  brandId: null,
  floor: '1',
  locationDescription: 'Next to LT19',
  latitude: 1.294,
  longitude: 103.7738,
  photoUrl: null,
  open24Hours: false,
  status: SupplierStatus.Active,
  version: 3,
  // Not part of the snapshot:
  nameKey: 'cool spot',
  createdAt: new Date('2026-11-01T00:00:00Z'),
} as unknown as Supplier;

describe('supplierSnapshot (F14.4)', () => {
  it('captures every supplier field, with sorted categories and the API form of the hours', () => {
    expect(
      supplierSnapshot(
        supplier,
        ['c2', 'c1'],
        [{ day: 0, opensAt: 540, closesAt: 1080 }],
      ),
    ).toEqual({
      id: 's1',
      name: 'Cool Spot',
      kind: 'Store',
      buildingId: 'b1',
      brandId: null,
      categoryIds: ['c1', 'c2'],
      floor: '1',
      locationDescription: 'Next to LT19',
      coordinates: { latitude: 1.294, longitude: 103.7738 },
      photoUrl: null,
      openingHours: { days: { mon: [{ opens: '09:00', closes: '18:00' }] } },
      status: 'Active',
      version: 3,
    });
  });

  it('shows no hours as null, and open around the clock as the flag', () => {
    expect(supplierSnapshot(supplier, [], []).openingHours).toBeNull();
    expect(
      supplierSnapshot(
        Object.assign({}, supplier, { open24Hours: true }),
        [],
        [],
      ).openingHours,
    ).toEqual({ open24Hours: true });
  });

  it('does not change the list it is given', () => {
    const ids = ['c2', 'c1'];
    supplierSnapshot(supplier, ids, []);
    expect(ids).toEqual(['c2', 'c1']);
  });

  it('is plain JSON, with no Date objects', () => {
    const snapshot = supplierSnapshot(supplier, ['c1'], []);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('requestSnapshot', () => {
  it('writes dates as ISO text and keeps the requested values', () => {
    const request = {
      id: 'r1',
      type: RequestType.Update,
      state: RequestState.Approved,
      supplierId: 's1',
      supplierVersion: 2,
      payload: { floor: '2' },
      submittedBy: 'u1',
      submittedAt: new Date('2026-11-02T10:00:00Z'),
      resolvedBy: 'a1',
      resolvedAt: new Date('2026-11-02T11:00:00Z'),
      denialReason: null,
      createdSupplierId: null,
      nameKey: null,
    } as unknown as SupplierRequest;

    expect(requestSnapshot(request)).toEqual({
      id: 'r1',
      type: 'Update',
      state: 'Approved',
      supplierId: 's1',
      supplierVersion: 2,
      values: { floor: '2' },
      submittedBy: 'u1',
      submittedAt: '2026-11-02T10:00:00.000Z',
      resolvedBy: 'a1',
      resolvedAt: '2026-11-02T11:00:00.000Z',
      denialReason: null,
      createdSupplierId: null,
    });
  });

  it('shows a pending request as not yet resolved', () => {
    const snapshot = requestSnapshot({
      id: 'r1',
      type: RequestType.Create,
      state: RequestState.Pending,
      payload: {},
      submittedAt: new Date('2026-11-02T10:00:00Z'),
      resolvedAt: null,
    } as unknown as SupplierRequest);

    expect(snapshot).toMatchObject({ resolvedAt: null, state: 'Pending' });
  });
});

describe('category, brand and building snapshots', () => {
  it('keep the name and whether retired', () => {
    const retiredAt = new Date('2026-11-03T00:00:00Z');
    expect(
      categorySnapshot({ id: 'c', name: 'Food', retiredAt: null } as Category),
    ).toEqual({ id: 'c', name: 'Food', retiredAt: null });
    expect(
      brandSnapshot({ id: 'b', name: 'Cheers', retiredAt } as Brand),
    ).toEqual({
      id: 'b',
      name: 'Cheers',
      retiredAt: '2026-11-03T00:00:00.000Z',
    });
  });

  it("keep a building's names, aliases and position", () => {
    const aliases = ['Com 2'];
    const snapshot = buildingSnapshot({
      id: 'b',
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases,
      latitude: 1.2939,
      longitude: 103.7742,
      retiredAt: null,
    } as Building);

    expect(snapshot).toEqual({
      id: 'b',
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases: ['Com 2'],
      coordinates: { latitude: 1.2939, longitude: 103.7742 },
      retiredAt: null,
    });
    expect(snapshot.aliases).not.toBe(aliases);
  });
});
