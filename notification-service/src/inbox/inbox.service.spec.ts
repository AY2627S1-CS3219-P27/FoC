import { describe, expect, it } from 'vitest';
import { hashEventPayload } from './inbox.service.js';

describe('hashEventPayload', () => {
  it('is stable across property order', () => {
    expect(
      hashEventPayload({
        requesterUserId: '11111111-1111-4111-8111-111111111111',
        courierUserId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toBe(
      hashEventPayload({
        courierUserId: '22222222-2222-4222-8222-222222222222',
        requesterUserId: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });

  it('changes when the evidence changes', () => {
    expect(hashEventPayload({ errandId: 'a' })).not.toBe(
      hashEventPayload({ errandId: 'b' }),
    );
  });

  it('produces a sha-256 hex digest', () => {
    expect(hashEventPayload({ errandId: 'a' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
