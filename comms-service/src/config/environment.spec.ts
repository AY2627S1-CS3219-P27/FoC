import { environmentSchema, type EnvironmentVariables } from './environment.js';

const required = {
  DB_HOST: 'comms-db',
  DB_PORT: '5432',
  DB_USERNAME: 'comms_service',
  DB_DATABASE: 'comms_service',
  DB_PASSWORD_FILE: '/run/secrets/comms_db_password',
  JWT_PUBLIC_KEY_FILE: '/run/secrets/jwt_public_key_comms_service',
  RABBITMQ_USER: 'comms-service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: '5672',
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq_password_comms_service',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
};

function validate(
  overrides: Record<string, unknown> = {},
): EnvironmentVariables {
  const result = environmentSchema.validate({ ...required, ...overrides });
  if (result.error) throw result.error;
  return result.value;
}

describe('environmentSchema', () => {
  it('applies foundation and WebSocket-only defaults', () => {
    const environment = validate();
    expect(environment.PORT).toBe(3000);
    expect(environment.REDIS_USERNAME).toBe('default');
    expect(environment.REDIS_DB_INDEX).toBe(0);
    expect(environment.SOCKET_PATH).toBe('/socket.io');
    expect(environment.SOCKET_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
    ]);
    expect(environment.SOCKET_TRANSPORT).toBe('websocket');
    expect(environment.RABBITMQ_EXCHANGE).toBe('foc.events');
    expect(environment.RABBITMQ_ORDER_ERRAND_ACCEPTED_QUEUE).toBe(
      'comms-service.order-errand-accepted.v1',
    );
    expect(environment.RABBITMQ_ORDER_ERRAND_DELIVERED_QUEUE).toBe(
      'comms-service.order-errand-delivered.v1',
    );
    expect(environment.RABBITMQ_ORDER_COURIER_CANCELLED_QUEUE).toBe(
      'comms-service.order-courier-cancelled.v1',
    );
    expect(environment.RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE).toBe(
      'comms-service.order-errand-cancelled.v1',
    );
    expect(environment.RABBITMQ_RETRY_EXCHANGE).toBe('foc.comms.retry');
    expect(environment.RABBITMQ_RETRY_RETURN_EXCHANGE).toBe('foc.comms.back');
    expect(environment.RABBITMQ_DEAD_LETTER_EXCHANGE).toBe('foc.comms.dlx');
    expect(environment.RABBITMQ_RETRY_DELAYS_MS).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ]);
  });

  it('parses and de-duplicates allowed origins', () => {
    expect(
      validate({
        SOCKET_ALLOWED_ORIGINS:
          'https://foc.example, http://localhost:5173,https://foc.example',
      }).SOCKET_ALLOWED_ORIGINS,
    ).toEqual(['https://foc.example', 'http://localhost:5173']);
  });

  it('accepts the configured canonical Socket.IO path', () => {
    expect(validate({ SOCKET_PATH: '/socket.io' }).SOCKET_PATH).toBe(
      '/socket.io',
    );
  });

  it.each([
    ['DB_PORT', 0],
    ['DB_PASSWORD_FILE', ''],
    ['JWT_PUBLIC_KEY_FILE', ''],
    ['RABBITMQ_PORT', 65_536],
    ['RABBITMQ_PASSWORD_FILE', ''],
    ['REDIS_DB_INDEX', -1],
    ['SOCKET_PATH', 'socket.io'],
    ['SOCKET_PATH', '/socket io'],
    ['SOCKET_PATH', '/socket.io?transport=websocket'],
    ['SOCKET_PATH', '/socket.io#fragment'],
    ['SOCKET_ALLOWED_ORIGINS', 'https://foc.example/path'],
    ['SOCKET_TRANSPORT', 'polling'],
  ])('rejects invalid %s', (name, value) => {
    expect(() => validate({ [name]: value })).toThrow();
  });

  it('requires all dependency connection settings', () => {
    const { DB_HOST: _omitted, ...withoutDbHost } = required;
    expect(() => {
      const result = environmentSchema.validate(withoutDbHost);
      if (result.error) throw result.error;
    }).toThrow();
  });

  it('requires HTTPS socket origins in production', () => {
    expect(() =>
      validate({
        NODE_ENV: 'production',
        SOCKET_ALLOWED_ORIGINS: 'http://foc.example',
      }),
    ).toThrow();
    expect(
      validate({
        NODE_ENV: 'production',
        SOCKET_ALLOWED_ORIGINS: 'https://foc.example',
      }).SOCKET_ALLOWED_ORIGINS,
    ).toEqual(['https://foc.example']);
  });

  it.each([
    ['RABBITMQ_EXCHANGE', 'foc.other'],
    ['RABBITMQ_ORDER_ERRAND_ACCEPTED_QUEUE', 'comms-service.other.v1'],
    ['RABBITMQ_ORDER_ERRAND_DELIVERED_QUEUE', 'comms-service.other.v1'],
    ['RABBITMQ_ORDER_COURIER_CANCELLED_QUEUE', 'comms-service.other.v1'],
    ['RABBITMQ_ORDER_ERRAND_CANCELLED_QUEUE', 'comms-service.other.v1'],
    ['RABBITMQ_RETRY_EXCHANGE', 'foc.other.retry'],
    ['RABBITMQ_RETRY_RETURN_EXCHANGE', 'foc.other.back'],
    ['RABBITMQ_DEAD_LETTER_EXCHANGE', 'foc.other.dlx'],
    ['RABBITMQ_RETRY_DELAYS_MS', '1000,2000,4000,8000'],
    ['RABBITMQ_RETRY_DELAYS_MS', '1000,2000,4000,8000,32000'],
  ])('rejects noncanonical topology setting %s', (name, value) => {
    expect(() => validate({ [name]: value })).toThrow();
  });
});
