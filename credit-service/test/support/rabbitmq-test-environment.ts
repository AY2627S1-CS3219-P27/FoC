const required = (
  environment: NodeJS.ProcessEnv,
  name: 'RABBITMQ_USERNAME' | 'RABBITMQ_PASSWORD' | 'RABBITMQ_HOST_PORT',
): string => {
  const value = environment[name];
  if (!value?.trim()) {
    throw new Error(
      `${name} is required for the isolated RabbitMQ messaging tests; ` +
        'create credit-service/.env from .env.example',
    );
  }
  return value;
};

export const buildRabbitMqTestUrl = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const username = required(environment, 'RABBITMQ_USERNAME');
  const password = required(environment, 'RABBITMQ_PASSWORD');
  const port = required(environment, 'RABBITMQ_HOST_PORT');
  const numericPort = Number(port);

  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error(
      'RABBITMQ_HOST_PORT must be an integer between 1 and 65535 for the ' +
        'isolated RabbitMQ messaging tests',
    );
  }

  return (
    `amqp://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
    `@127.0.0.1:${numericPort}`
  );
};
