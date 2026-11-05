import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
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
  Venue,
} from '../src/database/entities/index.js';
import { SupplierQueriesService } from '../src/suppliers/supplier-queries.service.js';
import { SuppliersService } from '../src/suppliers/suppliers.service.js';
import {
  hashValidationRequestPayload,
  SupplierValidationService,
} from '../src/validation/supplier-validation.service.js';
import { VenuesService } from '../src/venues/venues.service.js';

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
  deliveryBuildingId: string,
  eventId: string = randomUUID(),
  deliveryVenueId?: string,
): SupplierValidationRequestedEvent => ({
  eventId,
  eventType: 'SupplierValidationRequested',
  timestamp: '2026-10-20T10:00:00.000Z',
  publisher: 'order-service',
  payload: {
    errandId: randomUUID(),
    supplierId,
    deliveryBuildingId,
    ...(deliveryVenueId && { deliveryVenueId }),
  },
});

describe('supplier validation over the outbox (real PostgreSQL, F15.7)', () => {
  let dataSource: DataSource;
  let suppliers: SuppliersService;
  let queries: SupplierQueriesService;
  let buildings: BuildingsService;
  let venues: VenuesService;
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
    buildings = new BuildingsService(
      dataSource,
      dataSource.getRepository(Building),
      dataSource.getRepository(BuildingNameKey),
    );
    venues = new VenuesService(dataSource.getRepository(Venue));
    contracts = new AccountEventContractValidator();
    validation = new SupplierValidationService(
      dataSource,
      queries,
      buildings,
      venues,
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
               venues, building_name_keys, buildings
    `);
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

  it("answers on the transaction's own connection, so one pooled connection is enough", async () => {
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
        new BuildingsService(
          single,
          single.getRepository(Building),
          single.getRepository(BuildingNameKey),
        ),
        new VenuesService(single.getRepository(Venue)),
        contracts,
        config,
      );

      const result = await singleValidation.process(request(id, com2.id));

      expect(result).toMatchObject({ status: 'answered', outcome: 'FOUND' });
    } finally {
      await single.destroy();
    }
  });

  it('answers FOUND with the supplier snapshot, recording request and reply together (F15.7.2, F15.7.3)', async () => {
    const { id } = await coolSpot();
    const question = request(id, com2.id);

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
        deliveryBuilding: {
          id: com2.id,
          shortName: 'COM2',
          canonicalName: 'Computing 2',
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

    await validation.process(request(id, com2.id));

    const [reply] = await outbox();
    expect(reply.envelope).toMatchObject({
      payload: {
        outcome: 'FOUND',
        supplier: { status: 'Inactive', version: 2 },
      },
    });
  });

  it('answers NOT_FOUND, without a snapshot, for a supplier that does not exist', async () => {
    const result = await validation.process(request(randomUUID(), com2.id));

    expect(result).toMatchObject({ status: 'answered', outcome: 'NOT_FOUND' });
    const [reply] = await outbox();
    expect(reply.envelope).toMatchObject({
      payload: { outcome: 'NOT_FOUND' },
    });
    expect(
      (reply.envelope as { payload: Record<string, unknown> }).payload,
    ).not.toHaveProperty('supplier');
  });

  it('answers BUILDING_NOT_FOUND, without a snapshot, when the supplier exists but the delivery building is unknown', async () => {
    const { id } = await coolSpot();

    const result = await validation.process(request(id, randomUUID()));

    expect(result).toMatchObject({
      status: 'answered',
      outcome: 'BUILDING_NOT_FOUND',
    });
    const [reply] = await outbox();
    const payload = (reply.envelope as { payload: Record<string, unknown> })
      .payload;
    expect(payload).toMatchObject({ outcome: 'BUILDING_NOT_FOUND' });
    expect(payload).not.toHaveProperty('supplier');
    expect(payload).not.toHaveProperty('deliveryBuilding');
    expect(
      contracts.validate('supplier.validation-completed.v1', reply.envelope)
        .valid,
    ).toBe(true);
  });

  it('treats a retired delivery building like an unknown one', async () => {
    const { id } = await coolSpot();
    const old = await buildings.create({
      canonicalName: 'Old Block',
      shortName: 'OLD',
      aliases: [],
      latitude: 1.295,
      longitude: 103.775,
    });
    await buildings.retire(old.id);

    const result = await validation.process(request(id, old.id));

    expect(result).toMatchObject({ outcome: 'BUILDING_NOT_FOUND' });
  });

  it('answers NOT_FOUND when both the supplier and the building are unknown', async () => {
    const result = await validation.process(
      request(randomUUID(), randomUUID()),
    );

    expect(result).toMatchObject({ outcome: 'NOT_FOUND' });
  });

  it('reports an event id reused with a different building as a conflict', async () => {
    const { id } = await coolSpot();
    const question = request(id, com2.id);
    await validation.process(question);

    const result = await validation.process(
      request(id, randomUUID(), question.eventId),
    );

    expect(result).toEqual({
      status: 'event-id-conflict',
      eventId: question.eventId,
    });
  });

  it('answers a redelivered request only once (F15.7.4)', async () => {
    const { id } = await coolSpot();
    const question = request(id, com2.id);

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
    const question = request(id, com2.id);

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
    const question = request(id, com2.id);
    await validation.process(question);

    const result = await validation.process(
      request(randomUUID(), com2.id, question.eventId),
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
      buildings,
      venues,
      contracts,
      config,
    );

    await expect(
      failing.process(request(randomUUID(), com2.id)),
    ).rejects.toThrow('connection terminated');
    await expect(outbox()).resolves.toHaveLength(0);
    await expect(inbox()).resolves.toHaveLength(0);
  });

  describe('delivery venue', () => {
    const venueIn = (buildingId: string, code = 'LT19') =>
      venues.create({
        buildingId,
        code,
        name: 'Lecture Theatre 19',
        floor: '1',
        latitude: 1.2941,
        longitude: 103.7743,
      });
    const payloadOfReply = async () =>
      ((await outbox())[0].envelope as { payload: Record<string, unknown> })
        .payload;
    const meetsContract = async () =>
      contracts.validate(
        'supplier.validation-completed.v1',
        (await outbox())[0].envelope,
      ).valid;

    it('answers FOUND with the venue snapshot', async () => {
      const { id } = await coolSpot();
      const venue = await venueIn(com2.id);

      const result = await validation.process(
        request(id, com2.id, randomUUID(), venue.id),
      );

      expect(result).toMatchObject({ outcome: 'FOUND' });
      expect(await payloadOfReply()).toMatchObject({
        outcome: 'FOUND',
        deliveryVenue: {
          id: venue.id,
          code: 'LT19',
          name: 'Lecture Theatre 19',
          floor: '1',
          coordinates: { latitude: 1.2941, longitude: 103.7743 },
        },
      });
      expect(await meetsContract()).toBe(true);
    });

    it('omits deliveryVenue when the request names no venue', async () => {
      const { id } = await coolSpot();
      await venueIn(com2.id);

      await validation.process(request(id, com2.id));

      expect(await payloadOfReply()).not.toHaveProperty('deliveryVenue');
    });

    it.each([
      ['unknown', async () => randomUUID()],
      [
        'retired',
        async (buildingId: string) => {
          const venue = await venueIn(buildingId);
          await venues.retire(venue.id);
          return venue.id;
        },
      ],
      [
        'in another building',
        async () => {
          const other = await buildings.create({
            canonicalName: 'Computing 1',
            shortName: 'COM1',
            aliases: [],
            latitude: 1.2949,
            longitude: 103.7737,
          });
          return (await venueIn(other.id)).id;
        },
      ],
    ])(
      'answers VENUE_NOT_FOUND, with nothing attached, for a venue that is %s',
      async (_label, makeVenueId) => {
        const { id } = await coolSpot();
        const venueId = await makeVenueId(com2.id);

        const result = await validation.process(
          request(id, com2.id, randomUUID(), venueId),
        );

        expect(result).toMatchObject({
          status: 'answered',
          outcome: 'VENUE_NOT_FOUND',
        });
        const payload = await payloadOfReply();
        expect(payload).not.toHaveProperty('supplier');
        expect(payload).not.toHaveProperty('deliveryBuilding');
        expect(payload).not.toHaveProperty('deliveryVenue');
        expect(await meetsContract()).toBe(true);
      },
    );

    it('reports a missing supplier before a missing venue', async () => {
      const result = await validation.process(
        request(randomUUID(), com2.id, randomUUID(), randomUUID()),
      );

      expect(result).toMatchObject({ outcome: 'NOT_FOUND' });
    });

    it('reports a missing building before a missing venue', async () => {
      const { id } = await coolSpot();
      const venue = await venueIn(com2.id);

      const result = await validation.process(
        request(id, randomUUID(), randomUUID(), venue.id),
      );

      expect(result).toMatchObject({ outcome: 'BUILDING_NOT_FOUND' });
    });

    it('answers a redelivered venue request only once', async () => {
      const { id } = await coolSpot();
      const venue = await venueIn(com2.id);
      const question = request(id, com2.id, randomUUID(), venue.id);

      await validation.process(question);
      const again = await validation.process(structuredClone(question));

      expect(again).toMatchObject({ status: 'duplicate-event' });
      await expect(outbox()).resolves.toHaveLength(1);
    });

    it('reports an event id reused with a different venue as a conflict', async () => {
      const { id } = await coolSpot();
      const venue = await venueIn(com2.id);
      const question = request(id, com2.id, randomUUID(), venue.id);
      await validation.process(question);

      const result = await validation.process(
        request(id, com2.id, question.eventId, randomUUID()),
      );

      expect(result).toEqual({
        status: 'event-id-conflict',
        eventId: question.eventId,
      });
    });

    describe('the map-pin building', () => {
      const pinBuilding = () =>
        buildings.create({
          canonicalName: 'Other (map pin)',
          shortName: 'PIN',
          aliases: [],
          latitude: 1.295,
          longitude: 103.765,
        });

      it('answers FOUND for a pin errand, with no venue and no pin flag', async () => {
        const { id } = await coolSpot();
        const pin = await pinBuilding();

        const result = await validation.process(request(id, pin.id));

        expect(result).toMatchObject({ outcome: 'FOUND' });
        const payload = await payloadOfReply();
        expect(payload).toMatchObject({
          deliveryBuilding: {
            id: pin.id,
            shortName: 'PIN',
            canonicalName: 'Other (map pin)',
          },
        });
        expect(payload).not.toHaveProperty('deliveryVenue');
        expect(JSON.stringify(payload)).not.toContain('allowsPin');
        expect(await meetsContract()).toBe(true);
      });

      it.each([
        ['an unknown id', async () => randomUUID()],
        [
          'a venue of another building',
          async () => (await venueIn(com2.id)).id,
        ],
      ])(
        'answers VENUE_NOT_FOUND when a venue id is sent with it (%s)',
        async (_label, makeVenueId) => {
          const { id } = await coolSpot();
          const pin = await pinBuilding();
          const venueId = await makeVenueId();

          const result = await validation.process(
            request(id, pin.id, randomUUID(), venueId),
          );

          expect(result).toMatchObject({ outcome: 'VENUE_NOT_FOUND' });
          expect(await meetsContract()).toBe(true);
        },
      );
    });

    it('keeps the hash of a request without a venue unchanged', () => {
      const payload = {
        errandId: '11111111-1111-4111-8111-111111111111',
        supplierId: '22222222-2222-4222-8222-222222222222',
        deliveryBuildingId: '33333333-3333-4333-8333-333333333333',
      };
      const legacy = createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');

      expect(hashValidationRequestPayload(payload)).toBe(legacy);
    });
  });
});
