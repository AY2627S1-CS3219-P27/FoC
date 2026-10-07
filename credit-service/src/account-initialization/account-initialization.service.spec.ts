import { randomUUID } from 'node:crypto';
import type { UserRegisteredPayload } from '@foc/contracts';
import { hashUserRegisteredPayload } from './account-initialization.service.js';

describe('hashUserRegisteredPayload', () => {
  it('is independent of the input property insertion order', () => {
    const userId = randomUUID();
    const canonical: UserRegisteredPayload = {
      userId,
      email: 'alex@example.edu',
      displayName: 'Alex',
    };
    const reordered = {
      displayName: 'Alex',
      email: 'alex@example.edu',
      userId,
    } as UserRegisteredPayload;

    expect(hashUserRegisteredPayload(reordered)).toBe(
      hashUserRegisteredPayload(canonical),
    );
    expect(hashUserRegisteredPayload(canonical)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any validated payload field changes', () => {
    const payload: UserRegisteredPayload = {
      userId: randomUUID(),
      email: 'alex@example.edu',
      displayName: 'Alex',
    };
    const original = hashUserRegisteredPayload(payload);

    expect(
      hashUserRegisteredPayload({ ...payload, email: 'other@example.edu' }),
    ).not.toBe(original);
    expect(
      hashUserRegisteredPayload({ ...payload, displayName: 'Other' }),
    ).not.toBe(original);
    expect(
      hashUserRegisteredPayload({ ...payload, userId: randomUUID() }),
    ).not.toBe(original);
  });
});
