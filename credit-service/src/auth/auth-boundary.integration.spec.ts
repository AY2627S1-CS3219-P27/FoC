import { generateKeyPairSync } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  AccessTokenVerifier,
  FocAuthModule,
  InvalidAccessTokenError,
  JwtAuthGuard,
} from '@foc/auth';
import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { AuthKeyModule } from './auth-key.module.js';
import { AuthKeyService } from './auth-key.service.js';

describe('shared authentication boundary', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const signer = new JwtService({
    privateKey,
    signOptions: {
      algorithm: 'RS256',
      issuer: ACCESS_TOKEN_ISSUER,
      expiresIn: 900,
    },
  });

  it('registers the shared guard and verifies User Service tokens', async () => {
    const module = await Test.createTestingModule({
      imports: [
        AuthKeyModule,
        FocAuthModule.registerAsync({
          imports: [AuthKeyModule],
          inject: [AuthKeyService],
          useFactory: (authKeyService: AuthKeyService) => ({
            publicKey: authKeyService.getJwtPublicKey(),
          }),
        }),
      ],
    })
      .overrideProvider(AuthKeyService)
      .useValue({ getJwtPublicKey: () => publicKey })
      .compile();

    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);

    const token = await signer.signAsync({
      sub: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
    });
    await expect(
      module.get(AccessTokenVerifier).verify(token),
    ).resolves.toEqual({
      sub: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
    });

    const tampered = `${token.slice(0, -4)}AAAA`;
    await expect(
      module.get(AccessTokenVerifier).verify(tampered),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError);

    await module.close();
  });
});
