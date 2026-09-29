import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { SupplierRequestsService } from '../src/requests/supplier-requests.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';

const REQUEST_ID = randomUUID();

/** Stand-ins: the service itself is tested against a real database. */
function fakes() {
  const view = (state: string) => ({ id: REQUEST_ID, type: 'Create', state });
  return {
    submitCreation: vi.fn(async () => view('Pending')),
    listPending: vi.fn(async (query: { offset: number; limit: number }) => ({
      items: [],
      total: 0,
      offset: query.offset,
      limit: query.limit,
      hasMore: false,
    })),
    approve: vi.fn(async () => view('Approved')),
    deny: vi.fn(async () => view('Denied')),
  };
}

describe('supplier request endpoints (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let adminCookie: string;
  let stub: ReturnType<typeof fakes>;

  beforeAll(async () => {
    const { privateKey } = seedTestEnvironment();
    const { AppModule } = await import('../src/app.module.js');
    stub = fakes();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(SupplierRequestsService)
      .useValue(stub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
    // The token's sub is 7 (see access-token.ts).
    cookie = `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`;
    adminCookie = `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, { isAdmin: true })}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets a basic user file a creation, as themselves (F7.1, F13.1, F13.3)', async () => {
    const body = { name: 'Cool Spot', submittedBy: 'someone-else' };
    const response = await request(app.getHttpServer())
      .post('/supplier-requests/creations')
      .set('Cookie', cookie)
      .send(body)
      .expect(201);

    // The raw body reaches the service; the submitter comes from the token.
    expect(stub.submitCreation).toHaveBeenCalledWith(body, '7');
    expect(response.body).toMatchObject({ id: REQUEST_ID, state: 'Pending' });
  });

  it.each([
    ['GET', '/supplier-requests'],
    ['POST', `/supplier-requests/${REQUEST_ID}/approve`],
    ['POST', `/supplier-requests/${REQUEST_ID}/deny`],
  ])(
    'forbids %s %s to a basic user, changing nothing (F13.4, F13.5)',
    async (method, url) => {
      const response = await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'post'](url)
        .set('Cookie', cookie)
        .send({ reason: 'No' })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(stub.listPending).not.toHaveBeenCalled();
      expect(stub.approve).not.toHaveBeenCalled();
      expect(stub.deny).not.toHaveBeenCalled();
    },
  );

  it('lists pending requests for an admin with paging defaults (F6.7)', async () => {
    const response = await request(app.getHttpServer())
      .get('/supplier-requests?type=Create')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(stub.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Create', offset: 0, limit: 25 }),
    );
    expect(response.body).toMatchObject({ total: 0, limit: 25 });
  });

  it('approves as the admin in the token, answering 200', async () => {
    const response = await request(app.getHttpServer())
      .post(`/supplier-requests/${REQUEST_ID}/approve`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(stub.approve).toHaveBeenCalledWith(REQUEST_ID, '7');
    expect(response.body.state).toBe('Approved');
  });

  it('denies with a trimmed reason (F6.4)', async () => {
    await request(app.getHttpServer())
      .post(`/supplier-requests/${REQUEST_ID}/deny`)
      .set('Cookie', adminCookie)
      .send({ reason: '  Closed down ' })
      .expect(200);

    expect(stub.deny).toHaveBeenCalledWith(REQUEST_ID, '7', 'Closed down');
  });

  it('refuses a denial without a reason', async () => {
    const response = await request(app.getHttpServer())
      .post(`/supplier-requests/${REQUEST_ID}/deny`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(stub.deny).not.toHaveBeenCalled();
  });

  it('rejects a malformed request id', async () => {
    const response = await request(app.getHttpServer())
      .post('/supplier-requests/not-a-uuid/approve')
      .set('Cookie', adminCookie)
      .expect(400);

    expect(response.body.violations).toEqual([
      { field: 'id', reason: 'id must be a UUID' },
    ]);
  });
});
