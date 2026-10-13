import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AuthenticatedRequest,
  FocAuthModule,
  JwtAuthGuard,
} from '@foc/auth';
import { ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import {
  Controller,
  Get,
  type INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthKeyModule } from './auth-key.module.js';
import { AuthKeyService } from './auth-key.service.js';

const rsa = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const keys = rsa();

// Signs like user-service's login: RS256, its issuer, the contract's claims.
const sign = (privateKey: string, expiresIn = 900) =>
  new JwtService({
    privateKey,
    signOptions: { algorithm: 'RS256', issuer: ACCESS_TOKEN_ISSUER, expiresIn },
  }).signAsync({
    sub: '11111111-1111-4111-8111-111111111111',
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin: false,
    roles: [Role.Requester],
  });

// Stands in for a real errand route: guarded, reads the caller's identity.
@Controller('whoami')
class WhoAmIController {
  @Get()
  @UseGuards(JwtAuthGuard)
  whoami(@Req() req: AuthenticatedRequest) {
    return { sub: req.user.sub };
  }
}

describe('access-token auth', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    // The same registration as AppModule, with a generated key instead of a file.
    const module = await Test.createTestingModule({
      imports: [
        FocAuthModule.registerAsync({
          imports: [AuthKeyModule],
          inject: [AuthKeyService],
          useFactory: (k: AuthKeyService) => ({ publicKey: k.getJwtPublicKey() }),
        }),
      ],
      controllers: [WhoAmIController],
    })
      .overrideProvider(AuthKeyService)
      .useValue({ getJwtPublicKey: () => keys.publicKey })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/whoami`;
  });
  afterAll(() => app.close());

  const call = (token?: string) =>
    fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});

  it('rejects a request without a token', async () => {
    expect((await call()).status).toBe(401);
  });

  it('rejects a token signed by another key', async () => {
    expect((await call(await sign(rsa().privateKey))).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    expect((await call(await sign(keys.privateKey, -1))).status).toBe(401);
  });

  it('passes the verified identity to the route', async () => {
    const res = await call(await sign(keys.privateKey));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sub: '11111111-1111-4111-8111-111111111111',
    });
  });
});

describe('AuthKeyService', () => {
  const withFile = (contents: string) => {
    const path = join(mkdtempSync(join(tmpdir(), 'order-auth-')), 'key.pem');
    writeFileSync(path, contents);
    return new AuthKeyService({
      getOrThrow: () => path,
    } as unknown as ConfigService);
  };

  it('reads and trims the key file', () => {
    expect(withFile(`${keys.publicKey}\n`).getJwtPublicKey()).toBe(
      keys.publicKey.trim(),
    );
  });

  it('refuses an empty key file', () => {
    expect(() => withFile('  \n').getJwtPublicKey()).toThrow(/empty/);
  });
});
