import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CategoriesService } from '../src/categories/categories.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';

/** In-memory stand-in so the guards are tested without a database. */
function fakeCategoriesService() {
  const categories: { id: string; name: string }[] = [
    { id: randomUUID(), name: 'Food' },
  ];
  return {
    listActive: vi.fn(async () => categories),
    create: vi.fn(async (name: string) => {
      if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new ConflictException({
          code: 'DUPLICATE_NAME',
          message: 'A category with this name already exists.',
        });
      }
      const category = { id: randomUUID(), name };
      categories.push(category);
      return category;
    }),
  };
}

/** Every registered route (Express 5 router), with its HTTP method. */
function registeredRoutes(app: INestApplication) {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  return stack.flatMap((layer) => {
    const route = (layer as { route?: { path: string; methods: object } })
      .route;
    return route
      ? Object.keys(route.methods).map((method) => ({
          method,
          path: route.path,
        }))
      : [];
  });
}

describe('authentication and roles (e2e)', () => {
  let app: INestApplication;
  let privateKey: string;
  let categories: ReturnType<typeof fakeCategoriesService>;

  const basicToken = () => signAccessToken(privateKey);
  const adminToken = () => signAccessToken(privateKey, { isAdmin: true });
  const withCookie = (token: string) => `${ACCESS_TOKEN_COOKIE}=${token}`;

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    // Imported after the environment is seeded (see test-env.ts).
    const { AppModule } = await import('../src/app.module.js');
    categories = fakeCategoriesService();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(CategoriesService)
      .useValue(categories)
      .compile();

    app = moduleFixture.createNestApplication();
    // As in main.ts (and user-service's e2e): the guard reads request.cookies.
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    categories.create.mockClear();
  });

  describe('401: no valid access token (F13.2)', () => {
    it('rejects a request without a token', async () => {
      const response = await request(app.getHttpServer())
        .get('/categories')
        .expect(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      });
    });

    it.each([
      ['tampered', async () => `${(await basicToken()).slice(0, -4)}AAAA`],
      ['expired', () => signAccessToken(privateKey, { expiresIn: -60 })],
      [
        'signed with another key',
        () => {
          const other = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
          });
          return signAccessToken(other.privateKey);
        },
      ],
      [
        'from another issuer',
        () => signAccessToken(privateKey, { issuer: 'order-service' }),
      ],
      [
        'missing the isAdmin claim',
        () => signAccessToken(privateKey, { claims: { isAdmin: undefined } }),
      ],
    ])('rejects a %s token', async (_label, token) => {
      const response = await request(app.getHttpServer())
        .get('/categories')
        .set('Cookie', withCookie(await token()))
        .expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('any authenticated user (F13.3)', () => {
    it('lists categories with the login cookie', async () => {
      const response = await request(app.getHttpServer())
        .get('/categories')
        .set('Cookie', withCookie(await basicToken()))
        .expect(200);
      expect(response.body).toEqual([{ id: expect.any(String), name: 'Food' }]);
    });

    it('also accepts an Authorization: Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${await basicToken()}`)
        .expect(200);
    });
  });

  describe('admin only (F13.4, F13.5)', () => {
    it('forbids a basic user and performs no part of the operation', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', withCookie(await basicToken()))
        .send({ name: 'Snacks' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });
      expect(categories.create).not.toHaveBeenCalled();
    });

    it('checks the role before validating the body', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', withCookie(await basicToken()))
        .send({ name: '' })
        .expect(403);
    });

    it('lets an admin create a category', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', withCookie(await adminToken()))
        .send({ name: '  Snacks ' })
        .expect(201);

      expect(response.body).toEqual({ id: expect.any(String), name: 'Snacks' });
      expect(categories.create).toHaveBeenCalledWith('Snacks');
    });

    it('validates the admin’s input, listing every problem', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', withCookie(await adminToken()))
        .send({ name: '', version: 2 })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.violations.map((v: { field: string }) => v.field),
      ).toEqual(expect.arrayContaining(['name', 'version']));
    });

    it('answers 409 DUPLICATE_NAME for an existing category', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', withCookie(await adminToken()))
        .send({ name: 'food' })
        .expect(409);
      expect(response.body.code).toBe('DUPLICATE_NAME');
    });
  });

  it('leaves no route open without a token except /health (F13.2)', async () => {
    const routes = registeredRoutes(app);
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: 'post', path: '/categories' },
        { method: 'get', path: '/suppliers' },
        { method: 'get', path: '/suppliers/:id' },
        { method: 'get', path: '/buildings' },
      ]),
    );

    const open: string[] = [];
    for (const { method, path } of routes) {
      if (method === 'get' && path === '/health') {
        continue;
      }
      const url = path.replace(/:[^/]+/g, randomUUID());
      const response = await (
        request(app.getHttpServer()) as unknown as Record<
          string,
          (url: string) => request.Test
        >
      )[method](url);
      if (response.status !== 401) {
        open.push(`${method.toUpperCase()} ${path} → ${response.status}`);
      }
    }
    expect(open).toEqual([]);
  });
});
