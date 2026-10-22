import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@foc/observability';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { HealthController } from './health/health.controller.js';

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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions('user-service') }),
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
  controllers: [HealthController],
})
export class AppModule {}
