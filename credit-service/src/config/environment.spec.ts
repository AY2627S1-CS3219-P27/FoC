import { environmentSchema, EnvironmentVariables } from './environment.js';

const requiredEnvironment = {
  DB_HOST: 'credit-db',
  DB_PORT: '5432',
  DB_USERNAME: 'credit_service',
  DB_DATABASE: 'credit_service',
  DB_PASSWORD_FILE: '/run/secrets/credit_db_password',
  RABBITMQ_URL: 'amqp://credit_service:test@credit-rabbitmq:5672',
};

function validate(
  overrides: Record<string, unknown> = {},
): EnvironmentVariables {
  const result = environmentSchema.validate({
    ...requiredEnvironment,
    ...overrides,
  });

  if (result.error) {
    throw result.error;
  }

  return result.value;
}

describe('environmentSchema', () => {
  it('applies account, messaging, and outbox defaults', () => {
    const environment = validate();

    expect(environment.INITIAL_CREDIT_BALANCE).toBe(100);
    expect(environment.RABBITMQ_EXCHANGE).toBe('foc.events');
    expect(environment.RABBITMQ_USER_REGISTERED_QUEUE).toBe(
      'credit-service.user-registered.v1',
    );
    expect(environment.RABBITMQ_USER_REGISTERED_ROUTING_KEY).toBe(
      'user.registered.v1',
    );
    expect(environment.RABBITMQ_CREDIT_ACCOUNT_INITIALISED_ROUTING_KEY).toBe(
      'credit.account-initialised.v1',
    );
    expect(environment.RABBITMQ_RETRY_EXCHANGE).toBe('foc.credit.retry');
    expect(environment.RABBITMQ_RETRY_RETURN_EXCHANGE).toBe('foc.credit.back');
    expect(environment.RABBITMQ_DEAD_LETTER_EXCHANGE).toBe('foc.credit.dlx');
    expect(environment.RABBITMQ_PREFETCH).toBe(10);
    expect(environment.RABBITMQ_RETRY_DELAYS_MS).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ]);
    expect(environment.OUTBOX_POLL_INTERVAL_MS).toBe(1_000);
    expect(environment.OUTBOX_BATCH_SIZE).toBe(100);
    expect(environment.OUTBOX_CLAIM_LEASE_MS).toBe(30_000);
    expect(environment.OUTBOX_UNPUBLISHED_WARNING_MS).toBe(60_000);
  });

  it('accepts a custom retry-return exchange', () => {
    expect(
      validate({ RABBITMQ_RETRY_RETURN_EXCHANGE: 'foc.credit.return.v2' })
        .RABBITMQ_RETRY_RETURN_EXCHANGE,
    ).toBe('foc.credit.return.v2');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initial balance %s',
    (initialBalance) => {
      expect(() =>
        validate({ INITIAL_CREDIT_BALANCE: initialBalance }),
      ).toThrow();
    },
  );

  it.each(['http://rabbitmq:15672', 'credit-rabbitmq:5672', ''])(
    'rejects non-AMQP RabbitMQ URL %s',
    (rabbitmqUrl) => {
      expect(() => validate({ RABBITMQ_URL: rabbitmqUrl })).toThrow();
    },
  );

  it.each([
    '1000,2000,4000,8000',
    '1000,2000,2000,8000,16000',
    '1000,-2000,4000,8000,16000',
    '1000,invalid,4000,8000,16000',
  ])('rejects invalid retry schedule %s', (retryDelays) => {
    expect(() => validate({ RABBITMQ_RETRY_DELAYS_MS: retryDelays })).toThrow();
  });

  it.each([
    ['RABBITMQ_PREFETCH', 0],
    ['OUTBOX_POLL_INTERVAL_MS', 0],
    ['OUTBOX_BATCH_SIZE', 0],
    ['OUTBOX_CLAIM_LEASE_MS', 0],
    ['OUTBOX_UNPUBLISHED_WARNING_MS', 0],
  ])('rejects non-positive %s', (name, value) => {
    expect(() => validate({ [name]: value })).toThrow();
  });
});
