import { createRabbitMqConnectionUrl } from './rabbitmq-connection-url.provider.js';

const environment = {
  RABBITMQ_USER: 'credit/service',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: 5672,
  RABBITMQ_VHOST: '/foc',
  RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq',
};

describe('createRabbitMqConnectionUrl', () => {
  it('reads the secret once and percent-encodes credentials and vhost', () => {
    const readSecret = vi.fn().mockReturnValue('p@ss:/ word\r\n');

    expect(createRabbitMqConnectionUrl(environment, readSecret)).toBe(
      'amqp://credit%2Fservice:p%40ss%3A%2F%20word@rabbitmq:5672/%2Ffoc',
    );
    expect(readSecret).toHaveBeenCalledOnce();
    expect(readSecret).toHaveBeenCalledWith('/run/secrets/rabbitmq');
  });

  it('preserves spaces before the trailing newline', () => {
    expect(
      createRabbitMqConnectionUrl(environment, () => ' secret \n'),
    ).toContain(':%20secret%20@');
  });

  it('rejects an empty password file', () => {
    expect(() => createRabbitMqConnectionUrl(environment, () => '\n')).toThrow(
      'RabbitMQ password file must not be empty',
    );
  });

  it('propagates an unreadable password-file error', () => {
    expect(() =>
      createRabbitMqConnectionUrl(environment, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow('ENOENT');
  });
});
