import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import {
  AccessTokenVerifier,
  InvalidAccessTokenError,
} from './access-token-verifier.js';
import { generateRsaKeyPair } from '../testing/rsa-key-pair.js';
import { signAccessToken } from '../testing/sign-token.js';

describe('AccessTokenVerifier', () => {
  const keys = generateRsaKeyPair();
  // Configured exactly as FocAuthModule configures JwtModule.
  const jwtService = new JwtService({
    publicKey: keys.publicKeyPem,
    verifyOptions: {
      algorithms: ['RS256'],
      issuer: ACCESS_TOKEN_ISSUER,
    },
  });
  const verifier = new AccessTokenVerifier(jwtService);

  it('returns the authenticated user for a valid token', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      isAdmin: true,
      roles: [Role.Requester, Role.Courier],
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: true,
      roles: [Role.Requester, Role.Courier],
    });
  });

  it('returns the same user plus the validated absolute expiry', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      isAdmin: true,
      roles: [Role.Requester, Role.Courier],
      expiresInSeconds: 600,
    });
    const decoded = jwtService.decode<{ exp: number }>(token);

    const verified = await verifier.verifyWithMetadata(token);

    expect(verified).toEqual({
      user: await verifier.verify(token),
      expiresAt: new Date(decoded.exp * 1_000),
    });
  });

  it('rejects an expired token when requesting metadata', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      expiresInSeconds: -10,
    });

    await expect(verifier.verifyWithMetadata(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a non-access-token value when requesting metadata', async () => {
    await expect(
      verifier.verifyWithMetadata('refresh-token-value'),
    ).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects invalid access-token claims when requesting metadata', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      extraClaims: { unexpectedClaim: 'not in the schema' },
    });

    await expect(verifier.verifyWithMetadata(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token with a tampered signature', async () => {
    const token = await signAccessToken(keys.privateKeyPem);
    const tampered = `${token.slice(0, -4)}AAAA`;

    await expect(verifier.verify(tampered)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      expiresInSeconds: -10,
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token issued by another issuer', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      issuer: 'order-service',
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token whose claims violate the contract', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      extraClaims: { unexpectedClaim: 'not in the schema' },
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token with a non-participant role', async () => {
    const token = await signAccessToken(keys.privateKeyPem, {
      roles: ['admin'] as never,
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a non-JWT string', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });
});
