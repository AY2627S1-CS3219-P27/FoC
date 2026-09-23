import { RedisProvider, REDIS, MAX_STARTUP_RETRIES } from './redis.provider.js';
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

type ReconnectStrategy = (retries: number) => number | Error | false;

/** `socket` options most recently handed to the mocked createClient. */
function lastSocketOptions(): { reconnectStrategy: ReconnectStrategy } {
  const [options] = vi.mocked(createClient).mock.calls.at(-1) ?? [];
  return (
    options as unknown as { socket: { reconnectStrategy: ReconnectStrategy } }
  ).socket;
}

function configured() {
  setEnv({
    REDIS_PORT: '6379',
    REDIS_HOST: 'redis',
    REDIS_USERNAME: 'default',
    REDIS_DB_INDEX: '0',
  });
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
    configured();

    const client = await RedisProvider.useFactory(configService());

    expect(vi.mocked(createClient)).toHaveBeenCalledWith({
      socket: {
        port: 6379,
        host: 'redis',
        reconnectStrategy: expect.any(Function),
      },
      username: 'default',
      database: 0,
    });
    expect(client).toBeDefined();
  });

  it('attaches an error listener (node-redis crashes without one)', async () => {
    configured();

    await RedisProvider.useFactory(configService());

    expect(lastClient().on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('awaits connect during bootstrap', async () => {
    configured();

    await RedisProvider.useFactory(configService());

    expect(lastClient().connect).toHaveBeenCalledTimes(1);
  });

  it('propagates a connect failure so bootstrap aborts', async () => {
    configured();
    vi.mocked(createClient).mockImplementationOnce(
      () =>
        ({
          on: vi.fn(),
          connect: vi.fn().mockRejectedValue(new Error('boom')),
        }) as unknown as ReturnType<typeof createClient>,
    );

    await expect(RedisProvider.useFactory(configService())).rejects.toThrow(
      'boom',
    );
  });

  it('bounds reconnection attempts before the first successful connect', async () => {
    configured();
    // Hold the initial connect open so the strategy is observed while the
    // "has connected" latch is still false.
    let releaseConnect!: () => void;
    vi.mocked(createClient).mockImplementationOnce(
      () =>
        ({
          on: vi.fn(),
          connect: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                releaseConnect = resolve;
              }),
          ),
        }) as unknown as ReturnType<typeof createClient>,
    );

    const pending = RedisProvider.useFactory(configService());
    const { reconnectStrategy } = lastSocketOptions();

    // Every retry up to the bound yields a delay...
    for (let retries = 0; retries < MAX_STARTUP_RETRIES; retries++) {
      expect(typeof reconnectStrategy(retries)).toBe('number');
    }
    // ...after which the strategy gives up, rejecting `connect()`.
    expect(reconnectStrategy(MAX_STARTUP_RETRIES)).toBeInstanceOf(Error);
    expect(reconnectStrategy(MAX_STARTUP_RETRIES + 1)).toBeInstanceOf(Error);

    releaseConnect();
    await pending;
  });

  it('keeps retrying indefinitely once a connection has succeeded', async () => {
    configured();

    await RedisProvider.useFactory(configService());
    const { reconnectStrategy } = lastSocketOptions();

    // A mid-run outage must not permanently close the client, no matter how
    // long it lasts (retries reset per reconnection episode in node-redis).
    expect(reconnectStrategy(100)).not.toBeInstanceOf(Error);
    expect(typeof reconnectStrategy(100)).toBe('number');
  });

  it('passes through unset config values to the Redis client', async () => {
    configured();
    delete process.env.REDIS_HOST;

    await RedisProvider.useFactory(configService());

    expect(vi.mocked(createClient)).toHaveBeenCalledWith({
      socket: {
        port: 6379,
        host: undefined,
        reconnectStrategy: expect.any(Function),
      },
      username: 'default',
      database: 0,
    });
  });
});
