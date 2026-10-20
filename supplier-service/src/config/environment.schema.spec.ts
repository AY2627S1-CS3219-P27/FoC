import { environmentSchema, logLevelsUpTo } from './environment.schema.js';

const REQUIRED = {
  DB_HOST: 'supplier-db',
  DB_PORT: '5432',
  DB_USERNAME: 'supplier_service',
  DB_DATABASE: 'supplier_service',
  DB_PASSWORD_FILE: '/run/secrets/supplier_db_password',
  JWT_PUBLIC_KEY_FILE: '/run/secrets/supplier_jwt_public_key',
  RABBITMQ_USER: 'supplier-service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: '5672',
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/run/secrets/supplier_rabbitmq_password',
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
      CAMPUS_MIN_LATITUDE: 1.28,
      CAMPUS_MAX_LATITUDE: 1.31,
      CAMPUS_MIN_LONGITUDE: 103.74,
      CAMPUS_MAX_LONGITUDE: 103.79,
      SEED_ON_STARTUP: true,
      SEED_CSV_PATH: '/seed-data/supplier-seed-data.csv',
      PLACEHOLDER_IMAGE_URL: '',
      RABBITMQ_PORT: 5672,
      RABBITMQ_EXCHANGE: 'foc.events',
      RABBITMQ_RETRY_EXCHANGE: 'foc.supplier.retry',
      RABBITMQ_RETRY_RETURN_EXCHANGE: 'foc.supplier.back',
      RABBITMQ_DEAD_LETTER_EXCHANGE: 'foc.supplier.dlx',
      RABBITMQ_PREFETCH: 10,
      RABBITMQ_RETRY_DELAYS_MS: [1000, 2000, 4000, 8000, 16000],
      RABBITMQ_SUPPLIER_VALIDATION_QUEUE:
        'supplier-service.order-supplier-validation-requested.v1',
      RABBITMQ_SUPPLIER_VALIDATION_REQUESTED_ROUTING_KEY:
        'order.supplier-validation-requested.v1',
      RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY:
        'supplier.validation-completed.v1',
      OUTBOX_POLL_INTERVAL_MS: 1000,
    });
  });

  it('reads five increasing retry delays, and rejects anything else (F15.7.5)', () => {
    expect(
      environmentSchema.validate({
        ...REQUIRED,
        RABBITMQ_RETRY_DELAYS_MS: '500, 1000, 2000, 4000, 8000',
      }).value.RABBITMQ_RETRY_DELAYS_MS,
    ).toEqual([500, 1000, 2000, 4000, 8000]);

    for (const delays of [
      '1000,2000,4000,8000',
      '1000,1000,2000,4000,8000',
      '1000,x,2,3,4',
    ]) {
      const { error } = environmentSchema.validate({
        ...REQUIRED,
        RABBITMQ_RETRY_DELAYS_MS: delays,
      });
      expect(error?.details[0].path).toEqual(['RABBITMQ_RETRY_DELAYS_MS']);
    }
  });

  it('applies the outbox timing check', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      OUTBOX_RETRY_BASE_DELAY_MS: '5000',
      OUTBOX_RETRY_MAX_DELAY_MS: '1000',
    });

    expect(error).toBeDefined();
  });

  it('rejects a minimum above the default maximum (review #605)', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      CAMPUS_MIN_LATITUDE: '1.5',
    });

    expect(error?.message).toContain('CAMPUS_MIN_LATITUDE');
  });

  it('rejects a campus box whose maximum is not above its minimum', () => {
    const { error } = environmentSchema.validate({
      ...REQUIRED,
      CAMPUS_MIN_LATITUDE: '1.31',
      CAMPUS_MAX_LATITUDE: '1.28',
    });

    expect(error?.details[0].path).toEqual(['CAMPUS_MAX_LATITUDE']);
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
        'JWT_PUBLIC_KEY_FILE',
        'RABBITMQ_USER',
        'RABBITMQ_HOST',
        'RABBITMQ_PORT',
        'RABBITMQ_VHOST',
        'RABBITMQ_PASSWORD_FILE',
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

describe('PLACEHOLDER_IMAGE_URL', () => {
  it('accepts an http(s) URL and rejects anything else', () => {
    const ok = environmentSchema.validate({
      ...REQUIRED,
      PLACEHOLDER_IMAGE_URL: 'https://example.com/no-photo.png',
    });
    const bad = environmentSchema.validate({
      ...REQUIRED,
      PLACEHOLDER_IMAGE_URL: 'no-photo.png',
    });

    expect(ok.error).toBeUndefined();
    expect(bad.error?.details[0].path).toEqual(['PLACEHOLDER_IMAGE_URL']);
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
