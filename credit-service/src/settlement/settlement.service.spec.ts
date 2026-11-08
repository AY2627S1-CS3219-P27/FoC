import { randomUUID } from 'node:crypto';
import type { CreditSettlementEvent } from '@foc/contracts';
import { hashCreditSettlementPayload } from './settlement.service.js';

describe('hashCreditSettlementPayload', () => {
  const payload = (): CreditSettlementEvent['payload'] => ({
    errandId: randomUUID(),
    requesterUserId: randomUUID(),
    courierUserId: randomUUID(),
    courierAmount: 30,
    requesterAmount: 20,
    attempt: 1,
  });

  it('uses canonical field order rather than object insertion order', () => {
    const value = payload();
    const differentlyOrdered = {
      attempt: value.attempt,
      requesterAmount: value.requesterAmount,
      courierAmount: value.courierAmount,
      courierUserId: value.courierUserId,
      requesterUserId: value.requesterUserId,
      errandId: value.errandId,
    };

    expect(hashCreditSettlementPayload(differentlyOrdered)).toBe(
      hashCreditSettlementPayload(value),
    );
  });

  it('changes when any semantic field changes', () => {
    const value = payload();
    const establishedHash = hashCreditSettlementPayload(value);

    for (const changed of [
      { ...value, errandId: randomUUID() },
      { ...value, requesterUserId: randomUUID() },
      { ...value, courierUserId: randomUUID() },
      { ...value, courierAmount: value.courierAmount + 1 },
      { ...value, requesterAmount: value.requesterAmount + 1 },
      { ...value, attempt: value.attempt + 1 },
    ]) {
      expect(hashCreditSettlementPayload(changed)).not.toBe(establishedHash);
    }
  });
});
