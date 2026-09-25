import { environmentSchema, logLevelsUpTo } from './environment.schema.js';

const REQUIRED = {
  DB_HOST: 'supplier-db',
  DB_PORT: '5432',
  DB_USERNAME: 'supplier_service',
  DB_DATABASE: 'supplier_service',
  DB_PASSWORD_FILE: '/run/secrets/supplier_db_password',
};

describe('environmentSchema', () => {
  it('accepts the minimal environment and applies defaults', () => {
    const { value, error } = environmentSchema.validate(REQUIRED);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'log',
      DB_PORT: 5432,
      DB_MIGRATIONS_RUN: true,
    });
  });

  it('reports every missing variable at once', () => {
    const { error } = environmentSchema.validate({});

    const missing = error?.details.map((detail) => detail.path[0]);
    expect(missing).toEqual(
      expect.arrayContaining([
        'DB_HOST',
        'DB_PORT',
        'DB_USERNAME',
        'DB_DATABASE',
        'DB_PASSWORD_FILE',
      ]),
    );
  });

  it('rejects a log level another service uses but Nest does not', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      LOG_LEVEL: 'info',
    });

    expect(error?.details[0].path).toEqual(['LOG_LEVEL']);
  });

  it('rejects a non-numeric port', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      DB_PORT: 'postgres',
    });

    expect(error?.details[0].path).toEqual(['DB_PORT']);
  });
});

describe('logLevelsUpTo', () => {
  it('includes the chosen level and every more severe one', () => {
    expect(logLevelsUpTo('warn')).toEqual(['fatal', 'error', 'warn']);
  });

  it('includes everything for verbose', () => {
    expect(logLevelsUpTo('verbose')).toHaveLength(6);
  });
});
