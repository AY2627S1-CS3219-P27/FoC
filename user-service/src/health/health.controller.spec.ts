import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';

const withDataSource = (query: () => Promise<unknown>) =>
  new HealthController({ query } as unknown as DataSource);

describe('HealthController', () => {
  it('is ok while the database answers', async () => {
    await expect(
      withDataSource(() => Promise.resolve()).check(),
    ).resolves.toEqual({ status: 'ok' });
  });

  it('is unavailable when the database does not', async () => {
    await expect(
      withDataSource(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      ).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
