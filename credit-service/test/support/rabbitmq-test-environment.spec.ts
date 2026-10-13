import { buildRabbitMqTestUrl } from './rabbitmq-test-environment.js';

describe('buildRabbitMqTestUrl', () => {
  it('builds the isolated broker URL from component settings', () => {
    expect(
      buildRabbitMqTestUrl({
        RABBITMQ_USERNAME: 'credit test',
        RABBITMQ_PASSWORD: 'p@ss/word',
        RABBITMQ_HOST_PORT: '5675',
      }),
    ).toBe('amqp://credit%20test:p%40ss%2Fword@127.0.0.1:5675');
  });

  it.each(['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD', 'RABBITMQ_HOST_PORT'] as const)(
    'rejects a missing %s',
    (missingName) => {
      const environment: NodeJS.ProcessEnv = {
        RABBITMQ_USERNAME: 'credit_service_test',
        RABBITMQ_PASSWORD: 'secret',
        RABBITMQ_HOST_PORT: '5675',
      };
      delete environment[missingName];

      expect(() => buildRabbitMqTestUrl(environment)).toThrow(
        `${missingName} is required`,
      );
    },
  );

  it.each(['0', '65536', 'not-a-port', '1.5'])(
    'rejects invalid port %s',
    (port) => {
      expect(() =>
        buildRabbitMqTestUrl({
          RABBITMQ_USERNAME: 'credit_service_test',
          RABBITMQ_PASSWORD: 'secret',
          RABBITMQ_HOST_PORT: port,
        }),
      ).toThrow('RABBITMQ_HOST_PORT must be an integer between 1 and 65535');
    },
  );
});
