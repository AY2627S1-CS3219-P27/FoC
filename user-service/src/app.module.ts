import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createObserveModule } from '@nestjs/observe';
import { FocAuthModule } from '@foc/auth';
import { OutboxEvent, OutboxModule } from '@foc/outbox';
import { OtpModule } from './otp/otp.module.js';
import { environmentSchema } from './config/environment.schema.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PasswordResetModule } from './password-reset/password-reset.module.js';
import { SecretModule } from './secret/secret.module.js';
import { SecretService } from './secret/secret.service.js';
import { User } from './users/user.entity.js';
import { UserUpdateAudit } from './users/user-update-audit.entity.js';
import { RefreshToken } from './auth/refresh-token.entity.js';
import { AuthorizationModule } from './authorization/authorization.module.js';

/** Builds the broker URL for the outbox without exposing the password. */
function buildRabbitMqUrl(
  config: ConfigService,
  secrets: SecretService,
): string {
  const user = config.getOrThrow<string>('RABBITMQ_USER');
  const host = config.getOrThrow<string>('RABBITMQ_HOST');
  const port = config.getOrThrow<number>('RABBITMQ_PORT');
  const vhost = config.getOrThrow<string>('RABBITMQ_VHOST');
  return (
    `amqp://${encodeURIComponent(user)}:` +
    `${encodeURIComponent(secrets.getRabbitMqPassword())}@` +
    `${host}:${port}/${encodeURIComponent(vhost)}`
  );
}

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'user-service',
    }),
    SecretModule,
    // Verifies user-service access tokens with the shared RS256 public key
    // and exposes the standard JwtAuthGuard/RolesGuard/AdminGuard app-wide.
    FocAuthModule.registerAsync({
      imports: [SecretModule],
      inject: [SecretService],
      useFactory: (secretService: SecretService) => ({
        publicKey: secretService.getJwtPublicKey(),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService, SecretService],
      useFactory: (
        configService: ConfigService,
        secretService: SecretService,
      ) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: secretService.getDbPassword(),
        database: configService.get<string>('DB_DATABASE'),
        entities: [User, UserUpdateAudit, RefreshToken, OutboxEvent],
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE'),
      }),
    }),
    OutboxModule.forRootAsync({
      imports: [SecretModule],
      inject: [SecretService, ConfigService],
      useFactory: (secrets: SecretService, config: ConfigService) => ({
        exchange: 'foc.events',
        appId: 'user-service',
        rabbitMqUrl: buildRabbitMqUrl(config, secrets),
      }),
    }),
    OtpModule,
    AuthModule,
    AdminModule,
    PasswordResetModule,
    AuthorizationModule,
  ],
})
export class AppModule {}
