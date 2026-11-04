import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';

function controller(
  overrides: {
    db?: () => Promise<unknown>;
    rabbit?: () => Promise<void>;
    redis?: () => Promise<void>;
  } = {},
) {
  const dataSource = {
    query: overrides.db ?? vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const rabbitMq = {
    check: overrides.rabbit ?? vi.fn().mockResolvedValue(undefined),
  };
  const redis = {
    check: overrides.redis ?? vi.fn().mockResolvedValue(undefined),
  };
  return new HealthController(
    dataSource as never,
    rabbitMq as never,
    redis as never,
  );
}

describe('HealthController', () => {
  it('reports liveness without probing dependencies', () => {
    expect(controller().live()).toEqual({ status: 'ok' });
  });

  it('reports readiness after all dependencies answer', async () => {
    await expect(controller().ready()).resolves.toEqual({ status: 'ok' });
  });

  it.each(['database', 'rabbitmq', 'redis'] as const)(
    'sanitizes a %s readiness failure',
    async (dependency) => {
      const failure = vi
        .fn()
        .mockRejectedValue(new Error('secret connection detail'));
      const subject = controller({
        db: dependency === 'database' ? failure : undefined,
        rabbit: dependency === 'rabbitmq' ? failure : undefined,
        redis: dependency === 'redis' ? failure : undefined,
      });
      const promise = subject.ready();
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(promise).rejects.not.toThrow('secret connection detail');
    },
  );
});
