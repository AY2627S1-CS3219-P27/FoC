import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RedisProvider } from '../redis/redis.provider.js';
import { SecretModule } from '../secret/secret.module.js';
import { UsersModule } from '../users/users.module.js';
import { JwtModule } from '@nestjs/jwt';
import { SecretService } from '../secret/secret.service.js';
import { JWT_EXPIRATION_IN_SECONDS } from '../common/constants.js';

@Module({
  imports: [
    SecretModule,
    UsersModule,
    JwtModule.registerAsync({
      global: true,
      imports: [SecretModule],
      inject: [SecretService],
      useFactory: async (secretService: SecretService) => ({
        privateKey: secretService.getJwtPrivateKey(),
        publicKey: secretService.getJwtPublicKey(),
        signOptions: {
          expiresIn: JWT_EXPIRATION_IN_SECONDS,
          issuer: 'user-service',
          algorithm: 'RS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RedisProvider],
})
export class AuthModule {}
