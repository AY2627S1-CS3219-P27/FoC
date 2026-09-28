import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';

const SUPPLIER_ID = randomUUID();

/** Stand-ins: the queries themselves are tested against a real database. */
function fakes() {
  return {
    queries: {
      list: vi.fn(async (query: { offset: number; limit: number }) => ({
        items: [],
        total: 0,
        offset: query.offset,
        limit: query.limit,
        hasMore: false,
      })),
      get: vi.fn(async (id: string) => {
        if (id !== SUPPLIER_ID) {
          throw new NotFoundException({
            code: 'SUPPLIER_NOT_FOUND',
            message: `Supplier ${id} does not exist.`,
          });
        }
        return { id, name: 'Cool Spot', version: 3 };
      }),
    },
    buildings: {
      listActive: vi.fn(async () => [
        {
          id: randomUUID(),
          canonicalName: 'Computing 2',
          shortName: 'COM2',
          aliases: [],
          latitude: 1.2939,
          longitude: 103.7742,
        },
      ]),
    },
  };
}

describe('supplier and building read endpoints (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let stubs: ReturnType<typeof fakes>;

  beforeAll(async () => {
    const { privateKey } = seedTestEnvironment();
    const { AppModule } = await import('../src/app.module.js');
    stubs = fakes();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(SupplierQueriesService)
      .useValue(stubs.queries)
      .overrideProvider(BuildingsService)
      .useValue(stubs.buildings)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
    // Reading is open to any authenticated user, not only admins (F13.3).
    cookie = `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /suppliers', () => {
    it('applies the pagination defaults (N3.1.2)', async () => {
      const response = await request(app.getHttpServer())
        .get('/suppliers')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        hasMore: false,
      });
    });

    it('passes repeated filters through as lists', async () => {
      const [a, b] = [randomUUID(), randomUUID()];
      await request(app.getHttpServer())
        .get(`/suppliers?categoryId=${a}&categoryId=${b}&kind=Store&offset=5`)
        .set('Cookie', cookie)
        .expect(200);

      expect(stubs.queries.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          categoryId: [a, b],
          kind: ['Store'],
          offset: 5,
          limit: 25,
        }),
      );
    });

    it('rejects unknown and malformed parameters, listing each (F5.8)', async () => {
      const response = await request(app.getHttpServer())
        .get('/suppliers?colour=red&limit=5000&kind=Shop')
        .set('Cookie', cookie)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.violations.map((v: { field: string }) => v.field),
      ).toEqual(expect.arrayContaining(['colour', 'limit', 'kind']));
    });
  });

  describe('GET /suppliers/:id', () => {
    it('returns the supplier with its version as the ETag', async () => {
      const response = await request(app.getHttpServer())
        .get(`/suppliers/${SUPPLIER_ID}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.headers.etag).toBe('"3"');
      expect(response.body).toMatchObject({ id: SUPPLIER_ID, version: 3 });
    });

    it('rejects a malformed id in the standard error shape', async () => {
      const response = await request(app.getHttpServer())
        .get('/suppliers/not-a-uuid')
        .set('Cookie', cookie)
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        violations: [{ field: 'id', reason: 'id must be a UUID' }],
      });
    });

    it('answers 404 SUPPLIER_NOT_FOUND for an unknown id (F5.9.1)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/suppliers/${randomUUID()}`)
        .set('Cookie', cookie)
        .expect(404);

      expect(response.body.code).toBe('SUPPLIER_NOT_FOUND');
    });
  });

  describe('GET /buildings', () => {
    it('lists buildings with names and coordinates (F4.4)', async () => {
      const response = await request(app.getHttpServer())
        .get('/buildings')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toEqual([
        {
          id: expect.any(String),
          canonicalName: 'Computing 2',
          shortName: 'COM2',
          aliases: [],
          coordinates: { latitude: 1.2939, longitude: 103.7742 },
        },
      ]);
    });
  });
});
