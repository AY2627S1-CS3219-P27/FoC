import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redisSetMock, redisDelMock } = vi.hoisted(() => {
  const redisSetMock = vi.fn();
  const redisDelMock = vi.fn();
  return { redisSetMock, redisDelMock };
});

vi.mock('./redis-client.ts', () => ({
  redis: { set: redisSetMock, del: redisDelMock },
}));
vi.mock('../../utils/logger.ts', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { isDuplicate, forgetMessageId } from './dedup.ts';

const UUID = '3f2a8c1e-6b4d-4f9a-8e2b-1a2b3c4d5e6f';
const DEDUP_KEY = `email:seen:${UUID}`;

describe('isDuplicate', () => {
  beforeEach(() => {
    redisSetMock.mockReset();
    redisDelMock.mockReset();
    // Default: the store is up and the id was not seen before (SET NX -> 'OK').
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);
  });

  it('marks a fresh id atomically with SET NX and a 15-minute TTL', async () => {
    await expect(isDuplicate(UUID)).resolves.toBe(false);

    expect(redisSetMock).toHaveBeenCalledWith(DEDUP_KEY, '1', {
      EX: 900,
      NX: true,
    });
  });

  it('reports a duplicate when the id was already marked', async () => {
    redisSetMock.mockResolvedValue(null);

    await expect(isDuplicate(UUID)).resolves.toBe(true);
  });

  it('fails open when the dedup store is unavailable', async () => {
    redisSetMock.mockRejectedValue(new Error('redis down'));

    await expect(isDuplicate(UUID)).resolves.toBe(false);
  });

  it('clears the dedup mark by id', async () => {
    await forgetMessageId(UUID);

    expect(redisDelMock).toHaveBeenCalledWith(DEDUP_KEY);
  });

  it('fails open when clearing the dedup mark fails', async () => {
    redisDelMock.mockRejectedValue(new Error('redis down'));

    await expect(forgetMessageId(UUID)).resolves.toBeUndefined();
  });
});
