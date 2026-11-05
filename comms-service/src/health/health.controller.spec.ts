import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';

function controller(
  overrides: {
    db?: () => Promise<unknown>;
    rabbit?: () => Promise<void>;
    consumers?: () => Promise<void>;
    redis?: () => Promise<void>;
    socketRedis?: () => Promise<void>;
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
  const socketRedis = {
    check: overrides.socketRedis ?? vi.fn().mockResolvedValue(undefined),
  };
  return new HealthController(
    dataSource as never,
    rabbitMq as never,
    consumers as never,
    redis as never,
    socketRedis as never,
  );
}

describe('HealthController', () => {
  it('reports liveness without probing dependencies', () => {
    expect(controller().live()).toEqual({ status: 'ok' });
  });

  it('reports readiness after all dependencies answer', async () => {
    await expect(controller().ready()).resolves.toEqual({ status: 'ok' });
  });

  it.each(['database', 'rabbitmq', 'redis', 'socketRedis'] as const)(
    'sanitizes a %s readiness failure',
    async (dependency) => {
      const failure = vi
        .fn()
        .mockRejectedValue(new Error('secret connection detail'));
      const subject = controller({
        db: dependency === 'database' ? failure : undefined,
        rabbit: dependency === 'rabbitmq' ? failure : undefined,
        consumers: dependency === 'consumers' ? failure : undefined,
        redis: dependency === 'redis' ? failure : undefined,
        socketRedis: dependency === 'socketRedis' ? failure : undefined,
      });
      const promise = subject.ready();
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(promise).rejects.not.toThrow('secret connection detail');
    },
  );
});
