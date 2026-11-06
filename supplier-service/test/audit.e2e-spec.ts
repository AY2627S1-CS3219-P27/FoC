import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BuildingSeedService } from '../src/seed/building-seed.service.js';
import { currentActor } from '../src/audit/audit-context.js';
import { BrandsService } from '../src/brands/brands.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import { signAccessToken, TEST_USER_ID } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';
import { withoutBroker } from './without-broker.js';

const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Stand-ins that report who the audit context says is acting, so the test
 * shows the actor reaching the services, through the whole request, from the
 * token alone.
 */
function fakes() {
  return {
    categories: {
      create: vi.fn(async (name: string) => {
        // Awaiting first proves the context survives asynchronous work.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: randomUUID(), name: `${name} by ${currentActor()}` };
      }),
    },
    brands: {
      create: vi.fn(async (name: string) => ({
        id: randomUUID(),
        name: `${name} by ${currentActor()}`,
      })),
    },
  };
}

describe('the acting user reaches the services (e2e, F14.4)', () => {
  let app: INestApplication;
  let privateKey: string;

  const as = async (sub: string | undefined, isAdmin = true) =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, {
      isAdmin,
      ...(sub && { claims: { sub } }),
    })}`;

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    const { AppModule } = await import('../src/app.module.js');
    const stub = fakes();

    const moduleFixture = await withoutBroker(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(BuildingSeedService)
      .useValue({})
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(CategoriesService)
      .useValue(stub.categories)
      .overrideProvider(BrandsService)
      .useValue(stub.brands)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("is the token's subject", async () => {
    const response = await request(app.getHttpServer())
      .post('/categories')
      .set('Cookie', await as(undefined))
      .send({ name: 'Snacks' })
      .expect(201);

    expect(response.body.name).toBe(`Snacks by ${TEST_USER_ID}`);
  });

  it('is lower-cased, like every other user id', async () => {
    const response = await request(app.getHttpServer())
      .post('/categories')
      .set('Cookie', await as(OTHER_USER_ID.toUpperCase()))
      .send({ name: 'Snacks' })
      .expect(201);

    expect(response.body.name).toBe(`Snacks by ${OTHER_USER_ID}`);
  });

  it('can never come from the body (F13.1)', async () => {
    const response = await request(app.getHttpServer())
      .post('/categories')
      .set('Cookie', await as(undefined))
      .send({ name: 'Snacks', actorId: OTHER_USER_ID });

    // The unknown field is refused, and nothing is attributed to it.
    expect(response.status).toBe(400);
    const fine = await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', await as(undefined))
      .send({ name: 'Cheers' })
      .expect(201);
    expect(fine.body.name).toBe(`Cheers by ${TEST_USER_ID}`);
  });

  it('keeps simultaneous requests of different users apart', async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', await as(TEST_USER_ID))
        .send({ name: 'A' }),
      request(app.getHttpServer())
        .post('/categories')
        .set('Cookie', await as(OTHER_USER_ID))
        .send({ name: 'B' }),
    ]);

    expect(a.body.name).toBe(`A by ${TEST_USER_ID}`);
    expect(b.body.name).toBe(`B by ${OTHER_USER_ID}`);
  });

  it('does not set an actor for a refused request: no token is 401', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .send({ name: 'Snacks' })
      .expect(401);
  });

  it('leaves no actor behind after a request finishes', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .set('Cookie', await as(undefined))
      .send({ name: 'Snacks' })
      .expect(201);

    expect(currentActor()).toBeNull();
  });
});
