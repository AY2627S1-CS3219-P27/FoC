import { RedisProvider, REDIS } from './redis.provider.js';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

vi.mock('redis', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

const ENV_VARS = [
  'REDIS_PORT',
  'REDIS_HOST',
  'REDIS_USERNAME',
  'REDIS_DB_INDEX',
];

function setEnv(overrides: Record<string, string>) {
  for (const key of ENV_VARS) delete process.env[key];
  Object.assign(process.env, overrides);
}

function configService() {
  // Mirrors ConfigModule: Joi's convert pref coerces numeric keys.
  const numbers = new Set(['REDIS_PORT', 'REDIS_DB_INDEX']);
  return {
    get: (key: string): unknown => {
      const value = process.env[key];
      return numbers.has(key) && value !== undefined ? Number(value) : value;
    },
  } as unknown as ConfigService;
}

interface MockedClient {
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

/** Client instance most recently handed out by the mocked createClient. */
function lastClient(): MockedClient {
  const value = vi.mocked(createClient).mock.results.at(-1)?.value;
  return value as MockedClient;
}

describe('RedisProvider', () => {
  afterEach(() => {
    for (const key of ENV_VARS) delete process.env[key];
    vi.mocked(createClient).mockClear();
  });

  it('exports a REDIS injection token', () => {
    expect(typeof REDIS).toBe('symbol');
  });

  it('maps the provider to the REDIS token', () => {
    expect(RedisProvider.provide).toBe(REDIS);
  });

  it('injects the ConfigService', () => {
    expect(RedisProvider.inject).toEqual([ConfigService]);
  });

  it('constructs a Redis client from the configured values', async () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });

    const client = await RedisProvider.useFactory(configService());

    expect(vi.mocked(createClient)).toHaveBeenCalledWith({
      socket: { port: 6379, host: 'redis' },
      username: 'default',
      database: 0,
    });
    expect(client).toBeDefined();
  });

  it('attaches an error listener (node-redis crashes without one)', async () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });

    await RedisProvider.useFactory(configService());

    expect(lastClient().on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('awaits connect so an unreachable store fails fast at bootstrap', async () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });

    await RedisProvider.useFactory(configService());

    expect(lastClient().connect).toHaveBeenCalledTimes(1);
  });

  it('passes through unset config values to the Redis client', async () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });
    delete process.env.REDIS_HOST;

    await RedisProvider.useFactory(configService());

    expect(vi.mocked(createClient)).toHaveBeenCalledWith({
      socket: { port: 6379, host: undefined },
      username: 'default',
      database: 0,
    });
  });
});
