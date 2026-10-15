import { generateKeyPairSync } from 'node:crypto';
import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { JwtService } from '@nestjs/jwt';

// Access tokens for tests of guarded routes. Signed like user-service's login:
// RS256, its issuer, the contract's claims.

export const rsaKeyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

// One pair per test run; give its publicKey to FocAuthModule.
export const testKeys = rsaKeyPair();

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';

export function signAccessToken({
  sub = TEST_USER_ID,
  privateKey = testKeys.privateKey,
  expiresIn = 900,
}: { sub?: string; privateKey?: string; expiresIn?: number } = {}) {
  return new JwtService({
    privateKey,
    signOptions: { algorithm: 'RS256', issuer: ACCESS_TOKEN_ISSUER, expiresIn },
  }).signAsync({
    sub,
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin: false,
    roles: [Role.Requester],
  });
}
