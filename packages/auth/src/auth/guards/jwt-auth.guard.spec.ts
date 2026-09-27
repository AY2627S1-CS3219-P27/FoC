import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { AccessTokenVerifier } from '../../access-token/access-token-verifier.js';
import { generateRsaKeyPair } from '../../testing/rsa-key-pair.js';
import { signAccessToken } from '../../testing/sign-token.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const keys = generateRsaKeyPair();
  const verifier = new AccessTokenVerifier(
    new JwtService({
      publicKey: keys.publicKeyPem,
      verifyOptions: {
        algorithms: ['RS256'],
        issuer: ACCESS_TOKEN_ISSUER,
      },
    }),
  );
  const guard = new JwtAuthGuard(verifier);

  const contextFor = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as never;

  const signedToken = () => signAccessToken(keys.privateKeyPem);

  it('attaches the authenticated user from the cookie', async () => {
    const request = {
      cookies: { [ACCESS_TOKEN_COOKIE]: await signedToken() },
      headers: {},
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    const user = (request as { user: unknown }).user as {
      sub: number;
      roles: Role[];
    };
    expect(user.sub).toBe(7);
    expect(user.roles).toEqual([Role.Requester]);
  });

  it('falls back to the Authorization Bearer header', async () => {
    const request = {
      cookies: {},
      headers: { authorization: `Bearer ${await signedToken()}` },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });

  it('rejects a request without a token', async () => {
    const request = { cookies: {}, headers: {} };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an invalid token', async () => {
    const request = {
      cookies: { [ACCESS_TOKEN_COOKIE]: 'not-a-jwt' },
      headers: {},
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const request = {
      cookies: {
        [ACCESS_TOKEN_COOKIE]: await signAccessToken(keys.privateKeyPem, {
          expiresInSeconds: -10,
        }),
      },
      headers: {},
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
