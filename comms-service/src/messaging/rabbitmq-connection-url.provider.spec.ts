import { createRabbitMqConnectionUrl } from './rabbitmq-connection-url.provider.js';

describe('createRabbitMqConnectionUrl', () => {
  it('encodes credentials and vhost without trimming password spaces', () => {
    expect(
      createRabbitMqConnectionUrl(
        {
          RABBITMQ_USER: 'comms-service',
          RABBITMQ_HOST: 'rabbitmq',
          RABBITMQ_PORT: 5672,
          RABBITMQ_VHOST: '/foc',
          RABBITMQ_PASSWORD_FILE: '/secret',
        },
        () => ' pass word \n',
      ),
    ).toBe('amqp://comms-service:%20pass%20word%20@rabbitmq:5672/%2Ffoc');
  });

  it('rejects an empty secret', () => {
    expect(() =>
      createRabbitMqConnectionUrl(
        {
          RABBITMQ_USER: 'comms-service',
          RABBITMQ_HOST: 'rabbitmq',
          RABBITMQ_PORT: 5672,
          RABBITMQ_VHOST: '/foc',
          RABBITMQ_PASSWORD_FILE: '/secret',
        },
        () => '\n',
      ),
    ).toThrow('must not be empty');
  });
});
