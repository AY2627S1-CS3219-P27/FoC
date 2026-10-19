import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import { OutboxRelay } from '@foc/outbox';
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
      // HTTP smoke tests must not require a broker; the outbox relay owns the
      // only RabbitMQ connection opened at bootstrap.
      .overrideProvider(OutboxRelay)
      .useValue({ start: vi.fn(), close: vi.fn() })
      // UsersService is faked so the guarded user endpoints can run without a
      // Postgres container
      .overrideProvider(UsersService)
      .useValue({
        getUserByUuid: vi.fn(async (uuid: string) => ({
          uuid,
          email: 'eve@example.com',
          displayName: 'Eve',
          profilePictureUrl: null,
          roles: [Role.Requester],
          isAdmin: false,
        })),
        updateProfile: vi.fn(
          async (
            uuid: string,
            fields: { displayName?: string; profilePictureUrl?: string | null },
          ) => ({
            uuid,
            email: 'eve@example.com',
            displayName: fields.displayName ?? 'Eve',
            profilePictureUrl: fields.profilePictureUrl ?? null,
            roles: [Role.Requester],
            isAdmin: false,
          }),
        ),
        updateRoles: vi.fn(async (uuid: string, roles: Role[]) => ({
          uuid,
          email: 'eve@example.com',
          displayName: 'Eve',
          profilePictureUrl: null,
          roles,
          isAdmin: false,
        })),
        archiveSelf: vi.fn(async (uuid: string) => ({
          uuid,
          email: 'eve@example.com',
          displayName: 'Eve',
          profilePictureUrl: null,
          roles: [Role.Requester],
          isAdmin: false,
          isLocked: false,
          isArchived: true,
        })),
        adminUpdateUser: vi.fn(
          async (
            _actorUuid: string,
            targetUuid: string,
            fields: { isAdmin?: boolean; isArchived?: boolean },
          ) => ({
            uuid: targetUuid,
            email: 'mallory@example.com',
            displayName: 'Mallory',
            profilePictureUrl: null,
            roles: [Role.Requester],
            isAdmin: fields.isAdmin ?? false,
            isLocked: false,
            isArchived: fields.isArchived ?? false,
          }),
        ),
        adminCreateUser: vi.fn(
          async (
            _actorUuid: string,
            fields: {
              email: string;
              displayName: string;
              roles?: Role[];
              profilePictureUrl?: string | null;
              isAdmin?: boolean;
            },
          ) => ({
            uuid: '22222222-2222-4222-8222-222222222222',
            email: fields.email,
            displayName: fields.displayName,
            profilePictureUrl: fields.profilePictureUrl ?? null,
            roles: fields.roles ?? [],
            isAdmin: fields.isAdmin ?? false,
            isLocked: true,
            isArchived: false,
          }),
        ),
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

  describe('admin user update endpoint', () => {
    const TARGET_UUID = '22222222-2222-4222-8222-222222222222';

    it('rejects an unauthenticated admin update with 401', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .send({ isAdmin: true })
        .expect(401);
    });

    it('rejects a non-admin caller with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set('Authorization', `Bearer ${await signAccessToken()}`)
        .send({ isAdmin: true })
        .expect(403);
    });

    it('applies an admin update for an admin caller (F11)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isAdmin: true })
        .expect(200);

      expect(response.body).toEqual({
        uuid: TARGET_UUID,
        email: 'mallory@example.com',
        displayName: 'Mallory',
        profilePictureUrl: null,
        roles: [Role.Requester],
        isAdmin: true,
        isLocked: false,
        isArchived: false,
      });
    });

    it('archives an account for an admin caller and reports the flag (F12.2)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isArchived: true })
        .expect(200);

      expect(response.body).toMatchObject({
        uuid: TARGET_UUID,
        isArchived: true,
      });
    });

    it('un-archives an account for an admin caller (F12.3)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isArchived: false })
        .expect(200);

      expect(response.body).toMatchObject({
        uuid: TARGET_UUID,
        isArchived: false,
      });
    });

    it('rejects a non-boolean Archival Status with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isArchived: 'true' })
        .expect(400);
    });

    it('rejects a non-boolean Admin Status with 400 (F11.1.3)', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${TARGET_UUID}`)
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isAdmin: 'true' })
        .expect(400);
    });

    it('rejects a malformed target uuid with 400', async () => {
      await request(app.getHttpServer())
        .patch('/users/not-a-uuid')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ isAdmin: true })
        .expect(400);
    });
  });

  describe('self-archive endpoint', () => {
    it('rejects an unauthenticated archive with 401', async () => {
      await request(app.getHttpServer()).post('/users/me/archive').expect(401);
    });

    it('archives the caller and clears the session cookie (F12.1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/users/me/archive')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await signAccessToken()}`)
        .expect(201);

      expect(response.body).toEqual({
        uuid: '11111111-1111-4111-8111-111111111111',
        isArchived: true,
      });
      expect(response.headers['set-cookie']).toBeDefined();
    });
  });
  describe('admin user create endpoint', () => {
    it('rejects an unauthenticated user creation with 401', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'staff@company.com', displayName: 'Staff' })
        .expect(401);
    });

    it('rejects a non-admin caller with 403', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${await signAccessToken()}`)
        .send({ email: 'staff@company.com', displayName: 'Staff' })
        .expect(403);
    });

    it('creates a locked user for an admin caller and returns the admin view (F15)', async () => {
      const response = await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({
          email: 'staff@company.com',
          displayName: 'Staff Member',
          roles: [Role.Requester],
        })
        .expect(201);

      expect(response.body).toEqual({
        uuid: '22222222-2222-4222-8222-222222222222',
        displayName: 'Staff Member',
        email: 'staff@company.com',
        roles: [Role.Requester],
        profilePictureUrl: null,
        isAdmin: false,
        isLocked: true,
        isArchived: false,
      });
    });

    it('accepts a non-NUS email from an admin (F15.1.3)', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({
          email: 'contractor@external.io',
          displayName: 'Contractor',
        })
        .expect(201);
    });

    it('rejects a malformed email with 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ email: 'not-an-email', displayName: 'Staff' })
        .expect(400);
    });

    it('rejects a missing display name with 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({ email: 'staff@company.com' })
        .expect(400);
    });

    it('rejects a non-boolean Admin Status with 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({
          email: 'staff@company.com',
          displayName: 'Staff',
          isAdmin: 'true',
        })
        .expect(400);
    });

    it('rejects a non-participant role with 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .set(
          'Authorization',
          `Bearer ${await signAccessToken({ isAdmin: true })}`,
        )
        .send({
          email: 'staff@company.com',
          displayName: 'Staff',
          roles: ['admin'],
        })
        .expect(400);
    });
  });

  describe('profile endpoint', () => {
    it('rejects an unauthenticated profile update with 401', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ displayName: 'Eve Newman' })
        .expect(401);
    });

    it('updates the profile and clears the token when the display name changes', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await signAccessToken()}`)
        .send({
          displayName: 'Eve Newman',
          profilePictureUrl: 'https://example.com/new.png',
        })
        .expect(200);

      expect(response.body).toEqual({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
        displayName: 'Eve Newman',
        profilePictureUrl: 'https://example.com/new.png',
        roles: [Role.Requester],
        isAdmin: false,
      });
      // The token embeds the display name; a changed one invalidates it.
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('keeps the session when only the profile picture changes', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await signAccessToken()}`)
        .send({ profilePictureUrl: 'https://example.com/new.png' })
        .expect(200);

      expect(response.body).toMatchObject({
        uuid: '11111111-1111-4111-8111-111111111111',
        displayName: 'Eve',
        profilePictureUrl: 'https://example.com/new.png',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });
});
