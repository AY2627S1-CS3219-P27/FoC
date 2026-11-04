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
import { withoutBroker } from './without-broker.js';

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
    rename: vi.fn(async (id: string, name: string) => ({ id, name })),
    retire: vi.fn(async (id: string) => ({ id, name: 'Food' })),
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
    // The logger middleware (nestjs-pino) registers a catch-all "{/*splat}"
    // layer; it is not a controller route and has no URL to call.
    return route && !route.path.includes('*')
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

    const moduleFixture = await withoutBroker(
      Test.createTestingModule({
        imports: [AppModule],
      }),
    )
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
    categories.rename.mockClear();
    categories.retire.mockClear();
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

    it('forbids a basic user to rename or retire, performing nothing', async () => {
      const id = randomUUID();
      const cookie = withCookie(await basicToken());
      await request(app.getHttpServer())
        .patch(`/categories/${id}`)
        .set('Cookie', cookie)
        .send({ name: 'Meals' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/categories/${id}/retire`)
        .set('Cookie', cookie)
        .expect(403);

      expect(categories.rename).not.toHaveBeenCalled();
      expect(categories.retire).not.toHaveBeenCalled();
    });

    it('lets an admin rename a category, trimming the name (F11.2)', async () => {
      const id = randomUUID();
      const response = await request(app.getHttpServer())
        .patch(`/categories/${id}`)
        .set('Cookie', withCookie(await adminToken()))
        .send({ name: '  Meals ' })
        .expect(200);

      expect(response.body).toEqual({ id, name: 'Meals' });
      expect(categories.rename).toHaveBeenCalledWith(id, 'Meals');
    });

    it('lets an admin retire a category (F11.2, F11.3)', async () => {
      const id = randomUUID();
      await request(app.getHttpServer())
        .post(`/categories/${id}/retire`)
        .set('Cookie', withCookie(await adminToken()))
        .expect(200);

      expect(categories.retire).toHaveBeenCalledWith(id);
    });

    it('validates the id and the new name on rename', async () => {
      const admin = withCookie(await adminToken());
      await request(app.getHttpServer())
        .patch('/categories/not-a-uuid')
        .set('Cookie', admin)
        .send({ name: 'Meals' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/categories/${randomUUID()}`)
        .set('Cookie', admin)
        .send({ name: '' })
        .expect(400);
      expect(categories.rename).not.toHaveBeenCalled();
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
        { method: 'patch', path: '/categories/:id' },
        { method: 'post', path: '/categories/:id/retire' },
        { method: 'get', path: '/suppliers' },
        { method: 'get', path: '/suppliers/:id' },
        { method: 'get', path: '/buildings' },
        { method: 'get', path: '/brands' },
        { method: 'post', path: '/brands' },
        { method: 'patch', path: '/brands/:id' },
        { method: 'post', path: '/brands/:id/retire' },
        { method: 'post', path: '/buildings' },
        { method: 'patch', path: '/buildings/:id' },
        { method: 'post', path: '/buildings/:id/retire' },
        { method: 'post', path: '/suppliers' },
        { method: 'patch', path: '/suppliers/:id' },
        { method: 'put', path: '/suppliers/:id/status' },
        { method: 'post', path: '/supplier-requests/creations' },
        { method: 'post', path: '/supplier-requests/updates' },
        { method: 'post', path: '/supplier-requests/status-changes' },
        { method: 'get', path: '/supplier-requests' },
        { method: 'get', path: '/supplier-requests/mine' },
        { method: 'get', path: '/supplier-requests/:id' },
        { method: 'post', path: '/supplier-requests/:id/withdraw' },
        { method: 'post', path: '/supplier-requests/:id/approve' },
        { method: 'post', path: '/supplier-requests/:id/deny' },
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
