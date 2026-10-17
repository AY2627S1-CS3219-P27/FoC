import { environmentSchema } from './environment.schema.js';

const base = {
  DB_HOST: 'order-db',
  DB_PORT: '5432',
  DB_USERNAME: 'u',
  DB_DATABASE: 'd',
  DB_PASSWORD_FILE: '/p',
  JWT_PUBLIC_KEY_FILE: '/k',
  RABBITMQ_USER: 'order-service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: '5672',
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/p',
};

describe('consumer env', () => {
  it('defaults the retry topology', () => {
    const { value, error } = environmentSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      RABBITMQ_RETRY_EXCHANGE: 'foc.order.retry',
      RABBITMQ_RETRY_RETURN_EXCHANGE: 'foc.order.back',
      RABBITMQ_DEAD_LETTER_EXCHANGE: 'foc.order.dlx',
      RABBITMQ_PREFETCH: 10,
      RABBITMQ_RETRY_DELAYS_MS: [1000, 2000, 4000, 8000, 16000],
    });
  });

  it('parses a delay list and rejects a malformed one', () => {
    const ok = environmentSchema.validate({
      ...base,
      RABBITMQ_RETRY_DELAYS_MS: '1,2,3,4,5',
    });
    expect(ok.value.RABBITMQ_RETRY_DELAYS_MS).toEqual([1, 2, 3, 4, 5]);
    for (const bad of ['1,2,3', '5,4,3,2,1', '1,2,3,4,x']) {
      expect(
        environmentSchema.validate({ ...base, RABBITMQ_RETRY_DELAYS_MS: bad })
          .error,
      ).toBeDefined();
    }
  });
});

describe('auth env', () => {
  it('requires the JWT public key file', () => {
    const { JWT_PUBLIC_KEY_FILE: _, ...withoutKey } = base;
    expect(environmentSchema.validate(withoutKey).error?.message).toMatch(
      /JWT_PUBLIC_KEY_FILE/,
    );
  });
});
