import { randomUUID } from 'node:crypto';
import type { ErrandCancelledEvent } from '@foc/contracts';
import { hashErrandCancelledPayload } from './release.service.js';

describe('hashErrandCancelledPayload', () => {
  it('hashes only the canonical cancellation payload', () => {
    const payload: ErrandCancelledEvent['payload'] = { errandId: randomUUID() };

    expect(hashErrandCancelledPayload({ ...payload })).toBe(
      hashErrandCancelledPayload(payload),
    );
  });

  it('changes when the errand ID changes', () => {
    expect(hashErrandCancelledPayload({ errandId: randomUUID() })).not.toBe(
      hashErrandCancelledPayload({ errandId: randomUUID() }),
    );
  });
});
