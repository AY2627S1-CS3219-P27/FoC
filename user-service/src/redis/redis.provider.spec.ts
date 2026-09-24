import { RedisProvider, REDIS } from './redis.provider.js';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

vi.mock('ioredis', () => ({ Redis: vi.fn() }));

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

describe('RedisProvider', () => {
  afterEach(() => {
    for (const key of ENV_VARS) delete process.env[key];
    vi.mocked(Redis).mockClear();
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

    expect(vi.mocked(Redis)).toHaveBeenCalledWith({
      port: 6379,
      host: 'redis',
      username: 'default',
      db: 0,
    });
    expect(client).toBeDefined();
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

    expect(vi.mocked(Redis)).toHaveBeenCalledWith({
      port: 6379,
      host: undefined,
      username: 'default',
      db: 0,
    });
  });
});