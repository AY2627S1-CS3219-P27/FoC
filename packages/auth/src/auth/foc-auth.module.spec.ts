import {
  Controller,
  Get,
  INestApplication,
  Module,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE, Role } from '@foc/contracts';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { AdminGuard } from './guards/admin.guard.js';
import { FocAuthModule } from './foc-auth.module.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { Roles } from './guards/roles.decorator.js';
import { RolesGuard } from './guards/roles.guard.js';
import { generateRsaKeyPair } from '../testing/rsa-key-pair.js';
import { signAccessToken } from '../testing/sign-token.js';

@Controller('probe')
class ProbeController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return {
      sub: request.user.sub,
      email: request.user.email,
      roles: request.user.roles,
      isAdmin: request.user.isAdmin,
    };
  }

  @Get('courier')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Courier)
  courier(@Req() request: AuthenticatedRequest) {
    return { roles: request.user.roles };
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  admin() {
    return { ok: true };
  }
}

const PUBLIC_KEY = Symbol('PUBLIC_KEY');

// Generated once per suite run; module-provided so registerAsync's
// imports/inject forwarding can be exercised.
const asyncKeys = generateRsaKeyPair();

@Module({
  providers: [{ provide: PUBLIC_KEY, useValue: asyncKeys.publicKeyPem }],
  exports: [PUBLIC_KEY],
})
class PublicKeyModule {}

describe('FocAuthModule (integration)', () => {
  const keys = generateRsaKeyPair();
  let app: INestApplication;

  const requesterToken = () =>
    signAccessToken(keys.privateKeyPem, { roles: [Role.Requester] });
  const courierToken = () =>
    signAccessToken(keys.privateKeyPem, { roles: [Role.Courier] });
  const adminToken = () =>
    signAccessToken(keys.privateKeyPem, {
      roles: [Role.Requester],
      isAdmin: true,
    });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ProbeController],
      imports: [FocAuthModule.register({ publicKey: keys.publicKeyPem })],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Real services parse cookies with cookie-parser before guards run.
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('rejects an unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/probe/me').expect(401);
    });

    it('rejects an invalid token with 401', async () => {
      await request(app.getHttpServer())
        .get('/probe/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('rejects an expired token with 401', async () => {
      const token = await signAccessToken(keys.privateKeyPem, {
        expiresInSeconds: -10,
      });
      await request(app.getHttpServer())
        .get('/probe/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('accepts a valid Bearer token and exposes the user', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/me')
        .set('Authorization', `Bearer ${await requesterToken()}`)
        .expect(200);

      expect(response.body).toEqual({
        sub: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
        roles: [Role.Requester],
        isAdmin: false,
      });
    });

    it('accepts the access token cookie', async () => {
      await request(app.getHttpServer())
        .get('/probe/me')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await requesterToken()}`)
        .expect(200);
    });
  });

  describe('authorization', () => {
    it('allows a Courier on a courier-only route', async () => {
      await request(app.getHttpServer())
        .get('/probe/courier')
        .set('Authorization', `Bearer ${await courierToken()}`)
        .expect(200);
    });

    it('forbids a Requester on a courier-only route with 403', async () => {
      await request(app.getHttpServer())
        .get('/probe/courier')
        .set('Authorization', `Bearer ${await requesterToken()}`)
        .expect(403);
    });

    it('allows an admin on an admin-only route', async () => {
      await request(app.getHttpServer())
        .get('/probe/admin')
        .set('Authorization', `Bearer ${await adminToken()}`)
        .expect(200);
    });

    it('forbids a non-admin on an admin-only route with 403', async () => {
      await request(app.getHttpServer())
        .get('/probe/admin')
        .set('Authorization', `Bearer ${await requesterToken()}`)
        .expect(403);
    });
  });

  describe('registerAsync', () => {
    it('wires the public key through injected dependencies', async () => {
      const moduleFixture = await Test.createTestingModule({
        controllers: [ProbeController],
        imports: [
          FocAuthModule.registerAsync({
            imports: [PublicKeyModule],
            inject: [PUBLIC_KEY],
            useFactory: (publicKey: string) => ({ publicKey }),
          }),
        ],
      }).compile();

      const asyncApp = moduleFixture.createNestApplication();
      asyncApp.use(cookieParser());
      await asyncApp.init();

      try {
        await request(asyncApp.getHttpServer())
          .get('/probe/me')
          .set(
            'Authorization',
            `Bearer ${await signAccessToken(asyncKeys.privateKeyPem)}`,
          )
          .expect(200);
      } finally {
        await asyncApp.close();
      }
    });
  });
});
