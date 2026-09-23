import { Module } from '@nestjs/common';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { SecretService } from '../secret/secret.service.js';

export const EMAIL_SERVICE = Symbol('Email Service');

@Module({
  providers: [
    {
      provide: EMAIL_SERVICE,
      useFactory: (secrets: SecretService, config: ConfigService) => {
        const user = config.getOrThrow<string>('RABBITMQ_USER');
        const host = config.getOrThrow<string>('RABBITMQ_HOST');
        const port = config.getOrThrow<number>('RABBITMQ_PORT');
        const vhost = config.getOrThrow<string>('RABBITMQ_VHOST');
        return ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: [
              `amqp://${encodeURIComponent(user)}:` +
                `${encodeURIComponent(secrets.getRabbitMqPassword())}@` +
                `${host}:${port}/${encodeURIComponent(vhost)}`,
            ],
            exchange: 'foc.events',
            exchangeType: 'direct',
            wildcards: true,
          },
        });
      },
      inject: [SecretService, ConfigService],
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class BrokerModule {}
