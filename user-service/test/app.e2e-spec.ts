import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { REDIS } from '../src/redis/redis.provider.js';
import { SecretService } from '../src/secret/secret.service.js';
import { User } from '../src/users/user.entity.js';
import { UsersService } from '../src/users/users.service.js';
import { seedTestEnvironment } from './test-env.js';

// A real keypair so the guarded endpoints can be exercised end-to-end: the
// app verifies with the public key and the tests sign with the private key.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const jwtService = new JwtService({
  privateKey,
  signOptions: {
    algorithm: 'RS256',
    issuer: ACCESS_TOKEN_ISSUER,
    expiresIn: 900,
  },
});

function signAccessToken(
  overrides: {
    sub?: string;
    roles?: Role[];
    isAdmin?: boolean;
  } = {},
) {
  return jwtService.signAsync({
    sub: overrides.sub ?? '11111111-1111-4111-8111-111111111111',
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin: overrides.isAdmin ?? false,
    roles: overrides.roles ?? [Role.Requester],
  });
}

describe('user-service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // ConfigModule.forRoot validates the environment eagerly when the
    // AppModule decorator evaluates, before provider overrides apply — so the
    // module must be imported only after seeding, never statically at the top
    // of this file.
    seedTestEnvironment();
    const { AppModule } = await import('../src/app.module.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS)
      .useValue({})
      // The TypeORM DataSource factory would otherwise try to reach the
      // Postgres container during app.init(); the stub only needs to satisfy
      // the repository providers that inject it.
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        count: async () => 1,
      })
      // UsersService is faked so the guarded user endpoints can run without a
      // Postgres container
      .overrideProvider(UsersService)
      .useValue({
        getUserByUuid: vi.fn(async (uuid: string) => ({
          uuid,
          email: 'eve@example.com',
          displayName: 'Eve',
          roles: [Role.Requester],
          isAdmin: false,
        })),
        updateRoles: vi.fn(async (uuid: string, roles: Role[]) => ({
          uuid,
          email: 'eve@example.com',
          displayName: 'Eve',
          roles,
          isAdmin: false,
        })),
        countActiveAdmins: async () => 1,
      })
      .overrideProvider(SecretService)
      .useValue({
        getServerSecret: () => 'test-server-secret',
        getDbPassword: () => 'test-db-password',
        getRabbitMqPassword: () => 'test-rabbitmq-password',
        getJwtPrivateKey: () => privateKey,
        // The real public key drives FocAuthModule's verifier.
        getJwtPublicKey: () => publicKey,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots the application', () => {
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });

  describe('authentication on /users', () => {
    it('rejects an unauthenticated /users/me with 401', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('rejects a tampered token with 401', async () => {
      const token = await signAccessToken();
      const tampered = `${token.slice(0, -4)}AAAA`;
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);
    });

    it('returns the profile for a Bearer token', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${await signAccessToken()}`)
        .expect(200);

      expect(response.body).toMatchObject({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
        roles: [Role.Requester],
      });
    });

    it('returns the profile for the access token cookie', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await signAccessToken()}`)
        .expect(200);

      expect(response.body).toMatchObject({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
      });
    });
  });

  describe('roles endpoint', () => {
    it('rejects an unauthenticated role change with 401', async () => {
      await request(app.getHttpServer())
        .patch('/users/me/roles')
        .send({ roles: [Role.Requester] })
        .expect(401);
    });

    it('applies a role change from the cookie and clears it', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me/roles')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await signAccessToken()}`)
        .send({ roles: [Role.Requester, Role.Courier] })
        .expect(200);

      expect(response.body).toEqual({
        roles: [Role.Requester, Role.Courier],
      });
      expect(response.headers['set-cookie']).toBeDefined();
    });
  });
});
