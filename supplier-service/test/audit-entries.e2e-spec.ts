import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditEntriesService } from '../src/audit/audit-entries.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';
import { withoutBroker } from './without-broker.js';

const ID = '0b7e6c8a-3f0e-4c3f-9a55-2a9d0b7d1c11';

describe('GET /audit-entries (e2e, F14.4)', () => {
  let app: INestApplication;
  let privateKey: string;
  const list = vi.fn(async (query: { offset: number; limit: number }) => ({
    items: [],
    total: 0,
    offset: query.offset,
    limit: query.limit,
    hasMore: false,
  }));

  const basic = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`;
  const admin = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, { isAdmin: true })}`;

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture = await withoutBroker(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(AuditEntriesService)
      .useValue({ list })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    list.mockClear();
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get('/audit-entries').expect(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('forbids a basic user: who changed what is for admins (F13.4)', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit-entries')
      .set('Cookie', await basic())
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(list).not.toHaveBeenCalled();
  });

  it('lets an admin read it, with the paging defaults', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit-entries')
      .set('Cookie', await admin())
      .expect(200);

    expect(response.body).toEqual({
      items: [],
      total: 0,
      offset: 0,
      limit: 25,
      hasMore: false,
    });
  });

  it('passes the filters to the service', async () => {
    await request(app.getHttpServer())
      .get(
        `/audit-entries?targetType=supplier&targetId=${ID.toUpperCase()}&action=supplier.updated&limit=5`,
      )
      .set('Cookie', await admin())
      .expect(200);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'supplier',
        targetId: ID,
        action: 'supplier.updated',
        limit: 5,
      }),
    );
  });

  it('refuses unknown and malformed parameters, listing each', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit-entries?colour=red&targetType=widget&actorId=x')
      .set('Cookie', await admin())
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(
      response.body.violations.map((v: { field: string }) => v.field),
    ).toEqual(expect.arrayContaining(['colour', 'targetType', 'actorId']));
    expect(list).not.toHaveBeenCalled();
  });

  it('has no way to write: the log is append-only (F14.5)', async () => {
    const cookie = await admin();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request(app.getHttpServer())
        [method]('/audit-entries')
        .set('Cookie', cookie);
      expect(response.status).toBe(404);
    }
  });
});
