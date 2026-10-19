import { randomUUID } from 'node:crypto';

// Valid `payload` / `set` for the system edges that need them (payloads.ts),
// shaped like what the reply handlers send. Spread into a transition() input.

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
  set: { supplierValidatedAt: new Date('2030-01-01T00:00:00.000Z') },
  payload: { supplierEventId: randomUUID(), supplier: supplierSnapshot },
});

export const creditReserved = (reservedAmount = 5) => ({
  payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID(), reservedAmount },
});

export const creditAdjusted = () => ({
  type: 'CreditAdjusted',
  payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID() },
});

export const creditTransferFailed = () => ({
  payload: { creditEventId: randomUUID(), reason: 'DESTINATION_ARCHIVED' },
});

export const creditTransferred = (transferredAmount = 5) => ({
  payload: { creditEventId: randomUUID(), creditTransactionId: randomUUID(), transferredAmount },
});
