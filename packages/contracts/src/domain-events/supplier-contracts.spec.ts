import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import type { EventContractKey } from './event-registry.types.js';
import { SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY } from './events/supplier-validation-completed/v1/contract.js';
import { ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY } from './events/supplier-validation-requested/v1/contract.js';

const id = () => randomUUID();
const envelope = (
  eventType: string,
  publisher: string,
  payload: Record<string, unknown>,
) => ({
  eventId: id(),
  eventType,
  timestamp: '2026-10-20T10:00:00.000Z',
  publisher,
  payload,
});

const supplier = () => ({
  status: 'Active',
  version: 3,
  name: 'Cool Spot',
  displayName: 'Cool Spot @ COM2',
  building: { id: id(), shortName: 'COM2', canonicalName: 'Computing 2' },
  floor: '1',
  locationDescription: 'Next to LT19',
  coordinates: { latitude: 1.294, longitude: 103.7738 },
});

const deliveryBuilding = () => ({
  id: id(),
  shortName: 'SOC',
  canonicalName: 'School of Computing',
});

const deliveryVenue = () => ({
  id: id(),
  code: 'COM1-01-06',
  name: null,
  floor: '1',
  coordinates: { latitude: 1.2949, longitude: 103.7737 },
});

const question = () =>
  envelope('SupplierValidationRequested', 'order-service', {
    errandId: id(),
    supplierId: id(),
    deliveryBuildingId: id(),
  });

const questionWithVenue = () =>
  envelope('SupplierValidationRequested', 'order-service', {
    errandId: id(),
    supplierId: id(),
    deliveryBuildingId: id(),
    deliveryVenueId: id(),
  });

const found = () =>
  envelope('SupplierValidationCompleted', 'supplier-service', {
    errandId: id(),
    supplierId: id(),
    outcome: 'FOUND',
    supplier: supplier(),
    deliveryBuilding: deliveryBuilding(),
  });

const notFound = () =>
  envelope('SupplierValidationCompleted', 'supplier-service', {
    errandId: id(),
    supplierId: id(),
    outcome: 'NOT_FOUND',
  });

const foundWithVenue = () =>
  envelope('SupplierValidationCompleted', 'supplier-service', {
    errandId: id(),
    supplierId: id(),
    outcome: 'FOUND',
    supplier: supplier(),
    deliveryBuilding: deliveryBuilding(),
    deliveryVenue: deliveryVenue(),
  });

const venueNotFound = () =>
  envelope('SupplierValidationCompleted', 'supplier-service', {
    errandId: id(),
    supplierId: id(),
    outcome: 'VENUE_NOT_FOUND',
  });

const buildingNotFound = () =>
  envelope('SupplierValidationCompleted', 'supplier-service', {
    errandId: id(),
    supplierId: id(),
    outcome: 'BUILDING_NOT_FOUND',
  });

const validContracts = [
  [ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY, question()],
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, found()],
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, notFound()],
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, buildingNotFound()],
  [ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY, questionWithVenue()],
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, foundWithVenue()],
  [SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, venueNotFound()],
] as const satisfies ReadonlyArray<readonly [EventContractKey, object]>;

describe('supplier validation event contracts (Supplier FR F15.7)', () => {
  const validator = new AccountEventContractValidator();

  it.each(validContracts)('accepts the exact %s contract', (key, event) => {
    expect(validator.validate(key, structuredClone(event))).toEqual({
      valid: true,
      value: event,
    });
  });

  it.each(validContracts)(
    'rejects unknown payload fields for %s',
    (key, event) => {
      const input = structuredClone(event) as {
        payload: Record<string, unknown>;
      };
      input.payload.privateValue = 'do-not-accept';
      expect(validator.validate(key, input)).toMatchObject({
        valid: false,
        code: 'INVALID_PAYLOAD',
      });
    },
  );

  it.each(validContracts)('rejects a wrong publisher for %s', (key, event) => {
    const input = { ...structuredClone(event), publisher: 'credit-service' };
    expect(validator.validate(key, input)).toMatchObject({
      valid: false,
      code: 'INVALID_ENVELOPE',
    });
  });

  it.each(['errandId', 'supplierId', 'deliveryBuildingId'])(
    'rejects a question without %s, or with a non-UUID one',
    (field) => {
      const missing = question() as { payload: Record<string, unknown> };
      delete missing.payload[field];
      const malformed = question() as { payload: Record<string, unknown> };
      malformed.payload[field] = 'not-a-uuid';

      for (const input of [missing, malformed]) {
        expect(
          validator.validate(
            ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
            input,
          ),
        ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
      }
    },
  );

  it('requires the delivery building when FOUND', () => {
    const foundWithout = found() as { payload: Record<string, unknown> };
    delete foundWithout.payload.deliveryBuilding;
    expect(
      validator.validate(
        SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY,
        foundWithout,
      ),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('requires the supplier snapshot when FOUND, and forbids it when NOT_FOUND', () => {
    const foundWithout = found() as { payload: Record<string, unknown> };
    delete foundWithout.payload.supplier;
    const notFoundWith = notFound() as { payload: Record<string, unknown> };
    notFoundWith.payload.supplier = supplier();

    for (const input of [foundWithout, notFoundWith]) {
      expect(
        validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    }
  });

  it('forbids anything extra on NOT_FOUND and BUILDING_NOT_FOUND', () => {
    const foundBadBuilding = found() as {
      payload: { deliveryBuilding: Record<string, unknown> };
    };
    foundBadBuilding.payload.deliveryBuilding.coordinates = { latitude: 1 };
    const notFoundWith = notFound() as { payload: Record<string, unknown> };
    notFoundWith.payload.deliveryBuilding = deliveryBuilding();
    const missingWithSupplier = buildingNotFound() as {
      payload: Record<string, unknown>;
    };
    missingWithSupplier.payload.supplier = supplier();
    const missingWithBuilding = buildingNotFound() as {
      payload: Record<string, unknown>;
    };
    missingWithBuilding.payload.deliveryBuilding = deliveryBuilding();

    for (const input of [
      foundBadBuilding,
      notFoundWith,
      missingWithSupplier,
      missingWithBuilding,
    ]) {
      expect(
        validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    }
  });

  it('rejects an unknown outcome and a malformed snapshot', () => {
    const unknownOutcome = notFound() as { payload: Record<string, unknown> };
    unknownOutcome.payload.outcome = 'MAYBE';
    const badFloor = found() as {
      payload: { supplier: Record<string, unknown> };
    };
    badFloor.payload.supplier.floor = 'Z';
    const extraSnapshotField = found() as {
      payload: { supplier: Record<string, unknown> };
    };
    extraSnapshotField.payload.supplier.secret = 'nope';

    for (const input of [unknownOutcome, badFloor, extraSnapshotField]) {
      expect(
        validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    }
  });

  it('rejects a non-UUID delivery venue id', () => {
    const malformed = questionWithVenue() as {
      payload: Record<string, unknown>;
    };
    malformed.payload.deliveryVenueId = 'not-a-uuid';
    expect(
      validator.validate(
        ORDER_SUPPLIER_VALIDATION_REQUESTED_V1_ROUTING_KEY,
        malformed,
      ),
    ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('accepts a named venue and rejects a malformed venue snapshot', () => {
    const named = foundWithVenue() as {
      payload: { deliveryVenue: Record<string, unknown> };
    };
    named.payload.deliveryVenue.name = 'Seminar Room';
    expect(
      validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, named),
    ).toMatchObject({ valid: true });

    const mutations: Array<(venue: Record<string, unknown>) => void> = [
      (venue) => delete venue.code,
      (venue) => (venue.floor = 'Z'),
      (venue) => (venue.id = 'not-a-uuid'),
      (venue) => (venue.coordinates = { latitude: 1 }),
      (venue) => (venue.secret = 'nope'),
    ];
    for (const mutate of mutations) {
      const input = foundWithVenue() as {
        payload: { deliveryVenue: Record<string, unknown> };
      };
      mutate(input.payload.deliveryVenue);
      expect(
        validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    }
  });

  it('forbids a venue snapshot on every outcome but FOUND, and anything extra on VENUE_NOT_FOUND', () => {
    const inputs = [notFound(), buildingNotFound(), venueNotFound()].map(
      (event) => {
        const input = event as { payload: Record<string, unknown> };
        input.payload.deliveryVenue = deliveryVenue();
        return input;
      },
    );
    for (const extra of [
      ['supplier', supplier()],
      ['deliveryBuilding', deliveryBuilding()],
    ] as const) {
      const input = venueNotFound() as { payload: Record<string, unknown> };
      input.payload[extra[0]] = extra[1];
      inputs.push(input);
    }

    for (const input of inputs) {
      expect(
        validator.validate(SUPPLIER_VALIDATION_COMPLETED_V1_ROUTING_KEY, input),
      ).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
    }
  });
});
