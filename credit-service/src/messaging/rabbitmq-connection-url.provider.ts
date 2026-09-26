import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';

/** Shared connection URL used by both independent RabbitMQ connections. */
export const RABBITMQ_CONNECTION_URL = Symbol('RABBITMQ_CONNECTION_URL');

export interface RabbitMqConnectionEnvironment {
  RABBITMQ_USER: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  RABBITMQ_VHOST: string;
  RABBITMQ_PASSWORD_FILE: string;
}

/** Builds an AMQP URL without exposing the password through process.env. */
export function createRabbitMqConnectionUrl(
  environment: RabbitMqConnectionEnvironment,
  readSecret: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  // Docker secrets commonly end with a newline. Spaces remain significant.
  const password = readSecret(environment.RABBITMQ_PASSWORD_FILE).replace(
    /[\r\n]+$/,
    '',
  );
  if (password.length === 0) {
    throw new Error('RabbitMQ password file must not be empty');
  }

  return (
    `amqp://${encodeURIComponent(environment.RABBITMQ_USER)}:` +
    `${encodeURIComponent(password)}@${environment.RABBITMQ_HOST}:` +
    `${environment.RABBITMQ_PORT}/${encodeURIComponent(environment.RABBITMQ_VHOST)}`
  );
}

export const rabbitMqConnectionUrlProvider = {
  provide: RABBITMQ_CONNECTION_URL,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>): string =>
    createRabbitMqConnectionUrl({
      RABBITMQ_USER: config.getOrThrow('RABBITMQ_USER'),
      RABBITMQ_HOST: config.getOrThrow('RABBITMQ_HOST'),
      RABBITMQ_PORT: config.getOrThrow('RABBITMQ_PORT'),
      RABBITMQ_VHOST: config.getOrThrow('RABBITMQ_VHOST'),
      RABBITMQ_PASSWORD_FILE: config.getOrThrow('RABBITMQ_PASSWORD_FILE'),
    }),
};
