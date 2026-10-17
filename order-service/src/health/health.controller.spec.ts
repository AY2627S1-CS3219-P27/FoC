import { ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import { HealthController } from './health.controller.js';

const withPool = (query: () => Promise<unknown>) =>
  new HealthController({ query } as unknown as pg.Pool);

describe('HealthController', () => {
  it('is ok while the database answers', async () => {
    await expect(withPool(() => Promise.resolve()).check()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('is unavailable when the database does not', async () => {
    await expect(
      withPool(() => Promise.reject(new Error('ECONNREFUSED'))).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
