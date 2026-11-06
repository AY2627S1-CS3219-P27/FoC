import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { VenuesService } from '../src/venues/venues.service.js';
import { BuildingSeedService } from '../src/seed/building-seed.service.js';
import { BrandsService } from '../src/brands/brands.service.js';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import {
  IdempotencyService,
  type IdempotencyBegin,
  type StoredOutcome,
} from '../src/idempotency/idempotency.service.js';
import { SupplierRequestsService } from '../src/requests/supplier-requests.service.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import { signAccessToken, TEST_USER_ID } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';
import { withoutBroker } from './without-broker.js';

const SUPPLIER_ID = randomUUID();
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * The same rules as IdempotencyService (which the integration spec tests
 * against PostgreSQL), in memory, so this spec tests the interceptor: the
 * header, the fingerprint, what is replayed, and what a failure does.
 */
class InMemoryIdempotency {
  private rows = new Map<
    string,
    { claimId: string; fingerprint: string; outcome?: StoredOutcome }
  >();

  begin = vi.fn(
    async (
      userId: string,
      key: string,
      fingerprint: string,
    ): Promise<IdempotencyBegin> => {
      const id = `${userId}|${key}`;
      const row = this.rows.get(id);
      if (!row) {
        const claimId = randomUUID();
        this.rows.set(id, { claimId, fingerprint });
        return { kind: 'run', claimId };
      }
      if (row.fingerprint !== fingerprint) return { kind: 'mismatch' };
      return row.outcome
        ? { kind: 'replay', outcome: row.outcome }
        : { kind: 'in-progress' };
    },
  );
  complete = vi.fn(
    async (
      userId: string,
      key: string,
      claimId: string,
      outcome: StoredOutcome,
    ) => {
      const row = this.rows.get(`${userId}|${key}`);
      if (row?.claimId === claimId) row.outcome = outcome;
    },
  );
  release = vi.fn(async (userId: string, key: string, claimId: string) => {
    const id = `${userId}|${key}`;
    const row = this.rows.get(id);
    if (row?.claimId === claimId && !row.outcome) this.rows.delete(id);
  });
  reset() {
    this.rows.clear();
    vi.clearAllMocks();
  }
}

function fakes() {
  const view = (extra: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    ...extra,
  });
  return {
    suppliers: { create: vi.fn(async () => ({ id: SUPPLIER_ID })) },
    queries: {
      get: vi.fn(async (id: string) => ({ id, name: 'Cool Spot', version: 1 })),
    },
    requests: {
      submitCreation: vi.fn(async () => view({ state: 'Pending' })),
      submitUpdate: vi.fn(async () => view({ state: 'Pending' })),
      submitStatusChange: vi.fn(async () => view({ state: 'Pending' })),
    },
    categories: {
      create: vi.fn(async (name: string) => view({ name })),
      retire: vi.fn(async () => view({ name: 'Food' })),
    },
    brands: { create: vi.fn(async (name: string) => view({ name })) },
    buildings: {
      create: vi.fn(async (input: { canonicalName: string }) =>
        view({
          canonicalName: input.canonicalName,
          shortName: 'X',
          aliases: [],
          latitude: 1.29,
          longitude: 103.77,
        }),
      ),
    },
  };
}

describe('idempotency keys on the create endpoints (e2e, F14.2)', () => {
  let app: INestApplication;
  let stub: ReturnType<typeof fakes>;
  let store: InMemoryIdempotency;
  let privateKey: string;

  const basic = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey)}`;
  const admin = async () =>
    `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, { isAdmin: true })}`;

  beforeAll(async () => {
    ({ privateKey } = seedTestEnvironment());
    const { AppModule } = await import('../src/app.module.js');
    stub = fakes();
    store = new InMemoryIdempotency();

    const moduleFixture = await withoutBroker(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(BuildingSeedService)
      .useValue({})
      .overrideProvider(VenuesService)
      .useValue({ countActiveByBuilding: async () => new Map() })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(IdempotencyService)
      .useValue(store)
      .overrideProvider(SuppliersService)
      .useValue(stub.suppliers)
      .overrideProvider(SupplierQueriesService)
      .useValue(stub.queries)
      .overrideProvider(SupplierRequestsService)
      .useValue(stub.requests)
      .overrideProvider(CategoriesService)
      .useValue(stub.categories)
      .overrideProvider(BrandsService)
      .useValue(stub.brands)
      .overrideProvider(BuildingsService)
      .useValue(stub.buildings)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.reset();
  });

  /** Every endpoint that creates a record (F14.2), with a valid body. */
  const endpoints = [
    {
      name: 'POST /suppliers',
      path: '/suppliers',
      cookie: admin,
      body: { name: 'Cool Spot' },
      calls: () => stub.suppliers.create,
    },
    {
      name: 'POST /supplier-requests/creations',
      path: '/supplier-requests/creations',
      cookie: basic,
      body: { name: 'Cool Spot' },
      calls: () => stub.requests.submitCreation,
    },
    {
      name: 'POST /supplier-requests/updates',
      path: '/supplier-requests/updates',
      cookie: basic,
      body: { supplierId: SUPPLIER_ID, changes: { floor: '2' } },
      headers: { 'If-Match': '"1"' },
      calls: () => stub.requests.submitUpdate,
    },
    {
      name: 'POST /supplier-requests/status-changes',
      path: '/supplier-requests/status-changes',
      cookie: basic,
      body: { supplierId: SUPPLIER_ID, status: 'Inactive' },
      calls: () => stub.requests.submitStatusChange,
    },
    {
      name: 'POST /categories',
      path: '/categories',
      cookie: admin,
      body: { name: 'Snacks' },
      calls: () => stub.categories.create,
    },
    {
      name: 'POST /brands',
      path: '/brands',
      cookie: admin,
      body: { name: 'Cheers' },
      calls: () => stub.brands.create,
    },
    {
      name: 'POST /buildings',
      path: '/buildings',
      cookie: admin,
      body: {
        canonicalName: 'Science Library',
        shortName: 'SL',
        coordinates: { latitude: 1.2966, longitude: 103.7803 },
      },
      calls: () => stub.buildings.create,
    },
  ];

  const post = async (
    endpoint: (typeof endpoints)[number],
    key: string | undefined,
    body: unknown = endpoint.body,
  ) => {
    const call = request(app.getHttpServer())
      .post(endpoint.path)
      .set('Cookie', await endpoint.cookie());
    for (const [name, value] of Object.entries(endpoint.headers ?? {})) {
      call.set(name, value);
    }
    if (key !== undefined) call.set('Idempotency-Key', key);
    return call.send(body as object);
  };

  describe.each(endpoints)('$name', (endpoint) => {
    it('behaves as before without a key, doing the work each time', async () => {
      const first = await post(endpoint, undefined);
      const second = await post(endpoint, undefined);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(endpoint.calls()).toHaveBeenCalledTimes(2);
      expect(store.begin).not.toHaveBeenCalled();
    });

    it('answers a repeat with the original outcome, without doing it again (F14.2.1)', async () => {
      const key = randomUUID();
      const first = await post(endpoint, key);
      const second = await post(endpoint, key);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(endpoint.calls()).toHaveBeenCalledTimes(1);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.headers['idempotent-replayed']).toBe('true');
    });

    it('refuses the same key for a different payload, doing nothing (F14.2.2)', async () => {
      const key = randomUUID();
      await post(endpoint, key);

      const changed = await post(endpoint, key, {
        ...(endpoint.body as object),
        extra: 'different',
      });

      expect(changed.status).toBe(422);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(endpoint.calls()).toHaveBeenCalledTimes(1);
    });
  });

  it('replays the Location and ETag of a supplier create', async () => {
    const key = randomUUID();
    const first = await post(endpoints[0]!, key);
    const second = await post(endpoints[0]!, key);

    expect(first.headers.location).toBe(`/suppliers/${SUPPLIER_ID}`);
    expect(second.headers.location).toBe(first.headers.location);
    expect(first.headers.etag).toBeDefined();
    expect(second.headers.etag).toBe(first.headers.etag);
  });

  it('ignores the order of keys in the body', async () => {
    const key = randomUUID();
    const supplier = endpoints[3]!;
    await post(supplier, key, { supplierId: SUPPLIER_ID, status: 'Inactive' });

    const reordered = await post(supplier, key, {
      status: 'Inactive',
      supplierId: SUPPLIER_ID,
    });

    expect(reordered.status).toBe(201);
    expect(reordered.headers['idempotent-replayed']).toBe('true');
    expect(stub.requests.submitStatusChange).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key on another endpoint, even with the same body (F14.2.2)', async () => {
    const key = randomUUID();
    const body = { name: 'Same Name' };
    await post(endpoints[4]!, key, body); // categories
    const other = await post(endpoints[5]!, key, body); // brands

    expect(other.status).toBe(422);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(stub.brands.create).not.toHaveBeenCalled();
  });

  it('treats an edit request on another version as a different request', async () => {
    const key = randomUUID();
    const update = endpoints[2]!;
    await post(update, key);

    const call = await request(app.getHttpServer())
      .post(update.path)
      .set('Cookie', await basic())
      .set('If-Match', '"2"')
      .set('Idempotency-Key', key)
      .send(update.body);

    expect(call.status).toBe(422);
  });

  it('does not store a failure: a retry with the same key runs again (F14.2)', async () => {
    const key = randomUUID();
    const category = endpoints[4]!;
    stub.categories.create.mockRejectedValueOnce(
      new ConflictException({
        code: 'DUPLICATE_NAME',
        message: 'A category with this name already exists.',
      }),
    );

    const failed = await post(category, key);
    const retried = await post(category, key);

    expect(failed.status).toBe(409);
    expect(failed.body.code).toBe('DUPLICATE_NAME');
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
    expect(stub.categories.create).toHaveBeenCalledTimes(2);
    // And the success is then stored.
    const again = await post(category, key);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(stub.categories.create).toHaveBeenCalledTimes(2);
  });

  it('lets a corrected retry use the key after a validation failure', async () => {
    const key = randomUUID();
    const category = endpoints[4]!;

    const invalid = await post(category, key, { name: '' });
    const corrected = await post(category, key, { name: 'Snacks' });

    expect(invalid.status).toBe(400);
    expect(corrected.status).toBe(201);
    expect(stub.categories.create).toHaveBeenCalledTimes(1);
  });

  it('answers 409 IDEMPOTENCY_IN_PROGRESS to an identical request while one runs, then replays', async () => {
    const key = randomUUID();
    const category = endpoints[4]!;
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    stub.categories.create.mockImplementationOnce(async (name: string) => {
      await running;
      return { id: randomUUID(), name };
    });

    const first = post(category, key).then((response) => response);
    await vi.waitFor(() =>
      expect(stub.categories.create).toHaveBeenCalledTimes(1),
    );
    const during = await post(category, key);
    finish();
    const done = await first;
    const after = await post(category, key);

    expect(during.status).toBe(409);
    expect(during.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(during.headers['retry-after']).toBe('1');
    expect(done.status).toBe(201);
    expect(after.headers['idempotent-replayed']).toBe('true');
    expect(stub.categories.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', ''],
    ['over 255 characters', 'k'.repeat(256)],
  ])('refuses a key that is %s (400)', async (_, key) => {
    const response = await post(endpoints[4]!, key);

    expect(response.status).toBe(400);
    expect(response.body.violations).toEqual([
      {
        field: 'Idempotency-Key',
        reason: 'must be 1-255 printable characters',
      },
    ]);
    expect(stub.categories.create).not.toHaveBeenCalled();
  });

  it('answers 401 before looking at the key when there is no token', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Snacks' })
      .expect(401);

    expect(store.begin).not.toHaveBeenCalled();
    expect(stub.categories.create).not.toHaveBeenCalled();
  });

  it('answers 403 before looking at the key when a basic user is not allowed', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .set('Cookie', await basic())
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Snacks' })
      .expect(403);

    expect(store.begin).not.toHaveBeenCalled();
  });

  it('keeps the key per user: the same key from another user runs separately', async () => {
    const key = randomUUID();
    const supplierRequest = endpoints[1]!;
    await post(supplierRequest, key);

    const other = await request(app.getHttpServer())
      .post(supplierRequest.path)
      .set(
        'Cookie',
        `${ACCESS_TOKEN_COOKIE}=${await signAccessToken(privateKey, {
          claims: { sub: OTHER_USER_ID },
        })}`,
      )
      .set('Idempotency-Key', key)
      .send(supplierRequest.body);

    expect(other.status).toBe(201);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(stub.requests.submitCreation).toHaveBeenCalledTimes(2);
    expect(store.begin).toHaveBeenNthCalledWith(
      2,
      OTHER_USER_ID,
      key,
      expect.any(String),
    );
    expect(store.begin).toHaveBeenNthCalledWith(
      1,
      TEST_USER_ID,
      key,
      expect.any(String),
    );
  });

  it('does not apply to endpoints that do not create a record', async () => {
    await request(app.getHttpServer())
      .post(`/categories/${randomUUID()}/retire`)
      .set('Cookie', await admin())
      .set('Idempotency-Key', randomUUID());

    expect(store.begin).not.toHaveBeenCalled();
  });
});
