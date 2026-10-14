import { randomUUID } from 'node:crypto';
import type { ErrandCompletedEvent } from '@foc/contracts';
import { hashErrandCompletedPayload } from './transfer.service.js';

describe('hashErrandCompletedPayload', () => {
  it('uses canonical field order rather than object insertion order', () => {
    const payload: ErrandCompletedEvent['payload'] = {
      errandId: randomUUID(),
      requesterUserId: randomUUID(),
      courierUserId: randomUUID(),
      amount: 25,
    };
    const differentlyOrdered = {
      amount: payload.amount,
      courierUserId: payload.courierUserId,
      requesterUserId: payload.requesterUserId,
      errandId: payload.errandId,
    };

    expect(hashErrandCompletedPayload(differentlyOrdered)).toBe(
      hashErrandCompletedPayload(payload),
    );
  });

  it('changes when any canonical payload field changes', () => {
    const payload: ErrandCompletedEvent['payload'] = {
      errandId: randomUUID(),
      requesterUserId: randomUUID(),
      courierUserId: randomUUID(),
      amount: 25,
    };
    const establishedHash = hashErrandCompletedPayload(payload);

    expect(
      hashErrandCompletedPayload({ ...payload, amount: payload.amount + 1 }),
    ).not.toBe(establishedHash);
    expect(
      hashErrandCompletedPayload({ ...payload, courierUserId: randomUUID() }),
    ).not.toBe(establishedHash);
  });
});
