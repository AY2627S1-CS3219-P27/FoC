import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  AccountEventContractValidator,
  type SupplierValidationRequestedEvent,
} from '@foc/contracts';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { CategoriesService } from '../src/categories/categories.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  Building,
  BuildingNameKey,
  Category,
  InboxEvent,
  OutboxEvent,
  SupplierKind,
  SupplierStatus,
} from '../src/database/entities/index.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import { SupplierValidationService } from '../src/validation/supplier-validation.service.js';

const VALUES: Record<string, unknown> = {
  CAMPUS_MIN_LATITUDE: 1.28,
  CAMPUS_MAX_LATITUDE: 1.31,
  CAMPUS_MIN_LONGITUDE: 103.74,
  CAMPUS_MAX_LONGITUDE: 103.79,
  PLACEHOLDER_IMAGE_URL: '',
  RABBITMQ_SUPPLIER_VALIDATION_COMPLETED_ROUTING_KEY:
    'supplier.validation-completed.v1',
};
const config = {
  get: (key: string) => VALUES[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

const request = (
  supplierId: string,
  eventId: string = randomUUID(),
): SupplierValidationRequestedEvent => ({
  eventId,
  eventType: 'SupplierValidationRequested',
  timestamp: '2026-10-20T10:00:00.000Z',
  publisher: 'order-service',
  payload: { errandId: randomUUID(), supplierId },
});

describe('supplier validation over the outbox (real PostgreSQL, F15.7)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let validation: SupplierValidationService;
  let contracts: AccountEventContractValidator;
  let com2: Building;
  let food: Category;

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
        DB_MIGRATIONS_RUN: false,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });

    suppliers = new SuppliersService(dataSource, config);
    queries = new SupplierQueriesService(dataSource, config);
    contracts = new AccountEventContractValidator();
    validation = new SupplierValidationService(
      dataSource,
      queries,
      contracts,
      config,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE inbox_events, outbox_events, supplier_requests,
               supplier_categories, suppliers, categories,
               building_name_keys, buildings
    `);
    const buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    com2 = await buildings.create({
      canonicalName: 'Computing 2',
      shortName: 'COM2',
      aliases: [],
      latitude: 1.2939,
      longitude: 103.7742,
    });
    food = await new CategoriesService(
      dataSource.getRepository(Category),
    ).create('Food');
  });

  const coolSpot = () =>
    suppliers.create({
      name: 'Cool Spot',
      kind: SupplierKind.Store,
      categoryIds: [food.id],
      buildingId: com2.id,
      floor: '1',
      locationDescription: 'Next to LT19',
      coordinates: { latitude: 1.294, longitude: 103.7738 },
    });

  const outbox = () => dataSource.getRepository(OutboxEvent).find();
  const inbox = () => dataSource.getRepository(InboxEvent).find();

  it('answers on the transaction\'s own connection, so one pooled connection is enough', async () => {
    const { id } = await coolSpot();
    // A pool of one: a lookup on a second connection would wait for the
    // transaction's connection, and fail after the acquire timeout.
    const single = new DataSource({
      ...dataSource.options,
      poolSize: 1,
      connectTimeoutMS: 2_000,
    } as typeof dataSource.options);
    await single.initialize();
    try {
      const singleValidation = new SupplierValidationService(
        single,
        new SupplierQueriesService(single, config),
        contracts,
        config,
      );

      const result = await singleValidation.process(request(id));

      expect(result).toMatchObject({ status: 'answered', outcome: 'FOUND' });
    } finally {
      await single.destroy();
    }
  });

  it('answers FOUND with the supplier snapshot, recording request and reply together (F15.7.2, F15.7.3)', async () => {
    const { id } = await coolSpot();
    const question = request(id);

    const result = await validation.process(question);

    expect(result).toMatchObject({ status: 'answered', outcome: 'FOUND' });
    const [reply] = await outbox();
    expect(reply).toMatchObject({
      eventType: 'SupplierValidationCompleted',
      routingKey: 'supplier.validation-completed.v1',
      publishedAt: null,
    });
    expect(reply.envelope).toMatchObject({
      publisher: 'supplier-service',
      payload: {
        errandId: question.payload.errandId,
        supplierId: id,
        outcome: 'FOUND',
        supplier: {
          status: 'Active',
          version: 1,
          name: 'Cool Spot',
          displayName: 'Cool Spot @ COM2',
          building: {
            id: com2.id,
            shortName: 'COM2',
            canonicalName: 'Computing 2',
          },
          floor: '1',
          locationDescription: 'Next to LT19',
          coordinates: { latitude: 1.294, longitude: 103.7738 },
        },
      },
    });
    // The stored reply is exactly what the shared contract accepts.
    expect(
      contracts.validate('supplier.validation-completed.v1', reply.envelope)
        .valid,
    ).toBe(true);
    await expect(inbox()).resolves.toMatchObject([
      { eventId: question.eventId, replyEventId: reply.eventId },
    ]);
  });

  it('reports an Inactive supplier as FOUND with its status: Order Service decides (F15.2)', async () => {
    const { id } = await coolSpot();
    await suppliers.changeStatus(id, 1, SupplierStatus.Inactive);

    await validation.process(request(id));

    const [reply] = await outbox();
    expect(reply.envelope).toMatchObject({
      payload: {
        outcome: 'FOUND',
        supplier: { status: 'Inactive', version: 2 },
      },
    });
  });

  it('answers NOT_FOUND, without a snapshot, for a supplier that does not exist', async () => {
    const result = await validation.process(request(randomUUID()));

    expect(result).toMatchObject({ status: 'answered', outcome: 'NOT_FOUND' });
    const [reply] = await outbox();
    expect(reply.envelope).toMatchObject({
      payload: { outcome: 'NOT_FOUND' },
    });
    expect(
      (reply.envelope as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('supplier');
  });

  it('answers a redelivered request only once (F15.7.4)', async () => {
    const { id } = await coolSpot();
    const question = request(id);

    const first = await validation.process(question);
    const again = await validation.process(structuredClone(question));

    expect(again).toEqual({
      status: 'duplicate-event',
      replyEventId: (first as { replyEventId: string }).replyEventId,
    });
    await expect(outbox()).resolves.toHaveLength(1);
    await expect(inbox()).resolves.toHaveLength(1);
  });

  it('answers only once when the same request arrives twice at the same moment', async () => {
    const { id } = await coolSpot();
    const question = request(id);

    const results = await Promise.all([
      validation.process(question),
      validation.process(structuredClone(question)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'answered',
      'duplicate-event',
    ]);
    await expect(outbox()).resolves.toHaveLength(1);
  });

  it('reports an event id reused for a different request, writing nothing', async () => {
    const { id } = await coolSpot();
    const question = request(id);
    await validation.process(question);

    const result = await validation.process(
      request(randomUUID(), question.eventId),
    );

    expect(result).toEqual({
      status: 'event-id-conflict',
      eventId: question.eventId,
    });
    await expect(outbox()).resolves.toHaveLength(1);
  });

  it('never answers NOT_FOUND when the data store fails: it throws and writes nothing (F15.7.5)', async () => {
    const failing = new SupplierValidationService(
      dataSource,
      {
        get: () => Promise.reject(new Error('connection terminated')),
      } as unknown as SupplierQueriesService,
      contracts,
      config,
    );

    await expect(failing.process(request(randomUUID()))).rejects.toThrow(
      'connection terminated',
    );
    await expect(outbox()).resolves.toHaveLength(0);
    await expect(inbox()).resolves.toHaveLength(0);
  });
});
