import { RedisProvider, REDIS } from './redis.provider.js';
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

  it('constructs a Redis client from the environment', () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });

    const client = RedisProvider.useFactory();

    expect(vi.mocked(Redis)).toHaveBeenCalledWith({
      port: 6379,
      host: 'redis',
      username: 'default',
      db: 0,
    });
    expect(client).toBeDefined();
  });

  it('throws when REDIS_HOST is missing', () => {
    setEnv({
      REDIS_PORT: '6379',
      REDIS_USERNAME: 'default',
      REDIS_DB_INDEX: '0',
    });

    expect(() => RedisProvider.useFactory()).toThrow(
      'Environment variable REDIS_HOST is not set',
    );
  });
});
