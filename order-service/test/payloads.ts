import { randomUUID } from 'node:crypto';

// Valid `payload` / `set` for system edges, spread into a transition() input.

export const supplierSnapshot = {
  status: 'Active',
  version: 3,
  name: 'Cool Spot',
  displayName: 'Cool Spot @ COM2',
  building: { id: randomUUID(), shortName: 'COM2', canonicalName: 'Computing 2' },
  floor: '1',
  locationDescription: 'Next to LT19',
  coordinates: { latitude: 1.294, longitude: 103.7738 },
};

export const supplierValidated = () => ({
  set: {
    supplierValidatedAt: new Date('2030-01-01T00:00:00.000Z'),
    pickupName: 'Cool Spot @ COM2',
    pickupLocation: 'COM2',
    pickupDescription: 'Floor 1 · Next to LT19',
  },
  payload: { supplierEventId: randomUUID(), supplier: supplierSnapshot },
});

export const creditReserved = (reservedAmount = 5) => ({
  payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID(), reservedAmount },
});

