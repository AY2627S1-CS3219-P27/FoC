import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BuildingSeedService } from '../src/seed/building-seed.service.js';
import { BrandsService } from '../src/brands/brands.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';
import { withoutBroker } from './without-broker.js';

const BRAND_ID = randomUUID();

/** Stand-in: the service itself is tested against a real database. */
function fakes() {
  const brand = (name = 'Cheers') => ({ id: BRAND_ID, name });
  return {
    listActive: vi.fn(async () => [brand()]),
    create: vi.fn(async (name: string) => brand(name)),
    rename: vi.fn(async (_: string, name: string) => brand(name)),
    retire: vi.fn(async () => brand()),
  };
}

describe('brand endpoints (e2e)', () => {
  let app: INestApplication;
  let stub: ReturnType<typeof fakes>;
  let privateKey: string;

  const basic = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`;
  const admin = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, { isAdmin: true })}`;

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    const { AppModule } = await import('../src/app.module.js');
    stub = fakes();

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
      .overrideProvider(BrandsService)
      .useValue(stub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets any logged-in user list the brands, with id and name only (F3.5)', async () => {
    const response = await request(app.getHttpServer())
      .get('/brands')
      .set('Cookie', await basic())
      .expect(200);

    expect(response.body).toEqual([{ id: BRAND_ID, name: 'Cheers' }]);
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get('/brands').expect(401);
    await request(app.getHttpServer())
      .post('/brands')
      .send({ name: 'Cheers' })
      .expect(401);
  });

  it('forbids a basic user from creating, renaming or retiring, doing nothing (F3.3)', async () => {
    const cookie = await basic();
    await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', cookie)
      .send({ name: 'Cheers' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/brands/${BRAND_ID}`)
      .set('Cookie', cookie)
      .send({ name: 'Newco' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/brands/${BRAND_ID}/retire`)
      .set('Cookie', cookie)
      .expect(403);

    expect(stub.create).not.toHaveBeenCalled();
    expect(stub.rename).not.toHaveBeenCalled();
    expect(stub.retire).not.toHaveBeenCalled();
  });

  it('lets an admin create a brand, trimming the name (F3.3)', async () => {
    const response = await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', await admin())
      .send({ name: '  Mr Coconut ' })
      .expect(201);

    expect(stub.create).toHaveBeenCalledWith('Mr Coconut');
    expect(response.body).toEqual({ id: BRAND_ID, name: 'Mr Coconut' });
  });

  it('checks the role before validating the body', async () => {
    await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', await basic())
      .send({ name: '' })
      .expect(403);
  });

  it("lists every problem in the admin's input (F3.1)", async () => {
    const response = await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', await admin())
      .send({ name: 'x'.repeat(101), logoUrl: 'https://example.com/a.png' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(
      response.body.violations.map((v: { field: string }) => v.field),
    ).toEqual(expect.arrayContaining(['name', 'logoUrl']));
    expect(stub.create).not.toHaveBeenCalled();
  });

  it('answers 409 DUPLICATE_NAME for a name already in use (F3.2)', async () => {
    stub.create.mockRejectedValueOnce(
      new ConflictException({
        code: 'DUPLICATE_NAME',
        message: 'A brand with this name already exists.',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/brands')
      .set('Cookie', await admin())
      .send({ name: 'cheers' })
      .expect(409);

    expect(response.body.code).toBe('DUPLICATE_NAME');
  });

  it('lets an admin rename and retire a brand', async () => {
    const cookie = await admin();
    await request(app.getHttpServer())
      .patch(`/brands/${BRAND_ID}`)
      .set('Cookie', cookie)
      .send({ name: ' Newco ' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/brands/${BRAND_ID}/retire`)
      .set('Cookie', cookie)
      .expect(200);

    expect(stub.rename).toHaveBeenCalledWith(BRAND_ID, 'Newco');
    expect(stub.retire).toHaveBeenCalledWith(BRAND_ID);
  });

  it('validates the id on rename and retire', async () => {
    const cookie = await admin();
    await request(app.getHttpServer())
      .patch('/brands/not-a-uuid')
      .set('Cookie', cookie)
      .send({ name: 'Newco' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/brands/not-a-uuid/retire')
      .set('Cookie', cookie)
      .expect(400);
    expect(stub.rename).not.toHaveBeenCalled();
    expect(stub.retire).not.toHaveBeenCalled();
  });
});
