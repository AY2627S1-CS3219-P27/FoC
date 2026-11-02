import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';

export const RABBITMQ_CONNECTION_URL = Symbol('RABBITMQ_CONNECTION_URL');

export interface RabbitMqEnvironment {
  RABBITMQ_USER: string;
  RABBITMQ_HOST: string;
  RABBITMQ_PORT: number;
  RABBITMQ_VHOST: string;
  RABBITMQ_PASSWORD_FILE: string;
}

export function createRabbitMqConnectionUrl(
  environment: RabbitMqEnvironment,
  readSecret: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  const password = readSecret(environment.RABBITMQ_PASSWORD_FILE).replace(
    /[\r\n]+$/,
    '',
  );
  if (password.length === 0)
    throw new Error('RabbitMQ password file must not be empty');
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
      RABBITMQ_USER: config.get('RABBITMQ_USER', { infer: true }),
      RABBITMQ_HOST: config.get('RABBITMQ_HOST', { infer: true }),
      RABBITMQ_PORT: config.get('RABBITMQ_PORT', { infer: true }),
      RABBITMQ_VHOST: config.get('RABBITMQ_VHOST', { infer: true }),
      RABBITMQ_PASSWORD_FILE: config.get('RABBITMQ_PASSWORD_FILE', {
        infer: true,
      }),
    }),
};
