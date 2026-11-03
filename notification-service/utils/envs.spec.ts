import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `utils/envs.ts` parses the environment at module import, so each case
 * patches `process.env` and imports the module fresh.
 */
const REQUIRED: Record<string, string> = {
  RABBITMQ_USER: 'notification-service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: '5672',
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq_notification_password',
  DB_HOST: 'notification-db',
  DB_PORT: '5432',
  DB_USERNAME: 'notification_service',
  DB_DATABASE: 'notification_service',
  DB_PASSWORD_FILE: '/run/secrets/notification_db_password',
};

async function parseEnv(extra: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const key of [...Object.keys(REQUIRED), 'PORT', 'LOG_LEVEL']) {
    delete process.env[key];
  }
  Object.assign(process.env, REQUIRED);
  // Assigning `undefined` to process.env stores the *string* "undefined", so
  // unset keys must be deleted, not assigned.
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('./envs.ts');
}

function removePatchedEnv() {
  for (const key of [...Object.keys(REQUIRED), 'PORT', 'LOG_LEVEL']) {
    delete process.env[key];
  }
}

describe('envs', () => {
  afterEach(removePatchedEnv);

  it('accepts a complete environment', async () => {
    const { envs } = await parseEnv();
    expect(envs.RABBITMQ_USER).toBe('notification-service');
    expect(envs.DB_PORT).toBe(5432);
    expect(envs.DB_DATABASE).toBe('notification_service');
  });

  it('defaults PORT to 3000 and LOG_LEVEL to info', async () => {
    const { envs } = await parseEnv();
    expect(envs.PORT).toBe(3000);
    expect(envs.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from a string', async () => {
    const { envs } = await parseEnv({ PORT: '3007' });
    expect(envs.PORT).toBe(3007);
  });

  it('fails fast, reporting every missing key together', async () => {
    await expect(parseEnv({ RABBITMQ_HOST: undefined, DB_HOST: undefined })).rejects.toThrow(
      /RABBITMQ_HOST[\s\S]*DB_HOST|DB_HOST[\s\S]*RABBITMQ_HOST/,
    );
  });

  it('rejects a non-numeric PORT', async () => {
    await expect(parseEnv({ PORT: 'http' })).rejects.toThrow(/PORT/);
  });
});
