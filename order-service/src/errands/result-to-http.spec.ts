import { HttpException } from '@nestjs/common';
import { isReplay, resultToHttp } from './result-to-http.js';

// The thrown exception's status and body, or the returned body.
const outcome = (result: Parameters<typeof resultToHttp>[0]) => {
  try {
    return { body: resultToHttp(result) };
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    return { status: e.getStatus(), body: e.getResponse() };
  }
};

describe('resultToHttp', () => {
  it('returns the errand id for a create', () => {
    expect(outcome({ ok: true, errandId: 'e1' })).toEqual({ body: { errandId: 'e1' } });
  });

  it('returns the sequence number for a transition', () => {
    expect(outcome({ ok: true, sequenceNumber: 3 })).toEqual({ body: { sequenceNumber: 3 } });
  });

  it.each([
    ['INVALID_FIELDS', 400],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['ILLEGAL_TRANSITION', 409],
    ['EXPIRED', 409],
    ['COURIER_BUSY', 409],
    ['ROLE_BLOCKED', 403],
    ['IDEMPOTENCY_KEY_REUSED', 422],
  ] as const)('maps %s to %i with its code', (reason, status) => {
    const res = outcome({ ok: false, reason });
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code: reason, message: expect.any(String) });
  });

  it('maps STATE_MISMATCH to 409', () => {
    expect(
      outcome({ ok: false, reason: 'STATE_MISMATCH', currentStatus: 'Accepted' }),
    ).toMatchObject({ status: 409, body: { code: 'STATE_MISMATCH' } });
  });
});

describe('isReplay', () => {
  it.each([
    ['a replayed create', { ok: true, errandId: 'e1', replayed: true }, true],
    ['a replayed transition', { ok: true, sequenceNumber: 3, replayed: true }, true],
    ['a fresh create', { ok: true, errandId: 'e1' }, false],
    ['a fresh transition', { ok: true, sequenceNumber: 3 }, false],
    ['a failure', { ok: false, reason: 'FORBIDDEN' }, false],
  ] as const)('%s → %s', (_, result, expected) => {
    expect(isReplay(result)).toBe(expected);
  });
});
