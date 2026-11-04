import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports ok', async () => {
    await expect(new HealthController().check()).resolves.toEqual({
      status: 'ok',
    });
  });
});
