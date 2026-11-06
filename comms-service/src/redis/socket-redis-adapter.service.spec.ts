import type { ConfigService } from '@nestjs/config';
import type { RedisClientType } from 'redis';
import type { EnvironmentVariables } from '../config/environment.js';

const redisMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('redis', () => ({ createClient: redisMock.createClient }));

import { SocketRedisAdapterService } from './socket-redis-adapter.service.js';

interface FakeRedisClient {
  isOpen: boolean;
  isReady: boolean;
  connect: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function fakeClient(): FakeRedisClient {
  const client: FakeRedisClient = {
    isOpen: false,
    isReady: false,
    connect: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    publish: vi.fn().mockResolvedValue(1),
    quit: vi.fn(),
    on: vi.fn(),
  };
  client.connect.mockImplementation(async () => {
    client.isOpen = true;
    client.isReady = true;
  });
  client.quit.mockImplementation(async () => {
    client.isOpen = false;
    client.isReady = false;
  });
  return client;
}

function config(): ConfigService<EnvironmentVariables, true> {
  const values = {
    REDIS_HOST: 'redis.internal',
    REDIS_PORT: 6379,
    REDIS_USERNAME: 'default',
    REDIS_DB_INDEX: 2,
  };
  return {
    get: vi.fn((key: keyof typeof values) => values[key]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('SocketRedisAdapterService', () => {
  let publisher: FakeRedisClient;
  let subscriber: FakeRedisClient;

  beforeEach(() => {
    publisher = fakeClient();
    subscriber = fakeClient();
    redisMock.createClient.mockReset();
    redisMock.createClient
      .mockReturnValueOnce(publisher as unknown as RedisClientType)
      .mockReturnValueOnce(subscriber as unknown as RedisClientType);
  });

  it('owns distinct publisher and subscriber connections', async () => {
    const service = new SocketRedisAdapterService(config());

    await service.connect();

    expect(redisMock.createClient).toHaveBeenCalledTimes(2);
    expect(redisMock.createClient).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ disableOfflineQueue: true }),
    );
    expect(publisher.connect).toHaveBeenCalledOnce();
    expect(subscriber.connect).toHaveBeenCalledOnce();
    expect(service.getClients().publisher).not.toBe(publisher);
    expect(service.getClients().subscriber).toBe(subscriber);
  });

  it('checks both connections and reports degraded readiness', async () => {
    const service = new SocketRedisAdapterService(config());
    await service.connect();

    await expect(service.check()).resolves.toBeUndefined();
    expect(publisher.ping).toHaveBeenCalledOnce();
    expect(subscriber.ping).toHaveBeenCalledOnce();

    subscriber.isReady = false;
    await expect(service.check()).rejects.toThrow(
      'Socket adapter Redis connections are not ready',
    );
  });

  it('closes both adapter connections during shutdown', async () => {
    const service = new SocketRedisAdapterService(config());
    await service.connect();

    await service.onApplicationShutdown();

    expect(publisher.quit).toHaveBeenCalledOnce();
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });

  it('contains asynchronous adapter publish failures', async () => {
    publisher.publish.mockRejectedValueOnce(new Error('redis unavailable'));
    const service = new SocketRedisAdapterService(config());
    await service.connect();

    await expect(
      service.getClients().publisher.publish('channel', 'payload'),
    ).resolves.toBe(0);
  });
});
