import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_COOKIE } from '@foc/contracts';
import { ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BuildingsService } from '../src/buildings/buildings.service.js';
import { signAccessToken } from './access-token.js';
import { seedTestEnvironment } from './test-env.js';
import { withoutBroker } from './without-broker.js';

const BUILDING_ID = randomUUID();

/** Stand-in: the service itself is tested against a real database. */
function fakes() {
  const building = (input: Record<string, unknown> = {}) => ({
    id: BUILDING_ID,
    canonicalName: 'Computing 2',
    shortName: 'COM2',
    aliases: [] as string[],
    latitude: 1.2939,
    longitude: 103.7742,
    ...input,
  });
  return {
    listActive: vi.fn(async () => [building()]),
    create: vi.fn(async (input: Record<string, unknown>) => building(input)),
    updateNames: vi.fn(async (_: string, changes: Record<string, unknown>) =>
      building(changes),
    ),
    retire: vi.fn(async () => building()),
  };
}

const validBody = () => ({
  canonicalName: '  Science Library ',
  shortName: 'SL',
  aliases: [' Sci Lib ', 'SciLib'],
  coordinates: { latitude: 1.2966, longitude: 103.7803 },
});

describe('building management endpoints (e2e)', () => {
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
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(BuildingsService)
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

  it('forbids a basic user from creating, editing or retiring, doing nothing (F13.4)', async () => {
    const cookie = await basic();
    await request(app.getHttpServer())
      .post('/buildings')
      .set('Cookie', cookie)
      .send(validBody())
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/buildings/${BUILDING_ID}`)
      .set('Cookie', cookie)
      .send({ shortName: 'C2' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/buildings/${BUILDING_ID}/retire`)
      .set('Cookie', cookie)
      .expect(403);

    expect(stub.create).not.toHaveBeenCalled();
    expect(stub.updateNames).not.toHaveBeenCalled();
    expect(stub.retire).not.toHaveBeenCalled();
  });

  it('still lets any user list the buildings (F4.4)', async () => {
    await request(app.getHttpServer())
      .get('/buildings')
      .set('Cookie', await basic())
      .expect(200);
  });

  describe('create (F4.3)', () => {
    it('lets an admin create a building, trimming every name', async () => {
      const response = await request(app.getHttpServer())
        .post('/buildings')
        .set('Cookie', await admin())
        .send(validBody())
        .expect(201);

      expect(stub.create).toHaveBeenCalledWith({
        canonicalName: 'Science Library',
        shortName: 'SL',
        aliases: ['Sci Lib', 'SciLib'],
        latitude: 1.2966,
        longitude: 103.7803,
      });
      expect(response.body).toMatchObject({
        id: BUILDING_ID,
        coordinates: { latitude: 1.2966, longitude: 103.7803 },
      });
    });

    it('treats missing aliases as none', async () => {
      const { aliases: _, ...body } = validBody();
      await request(app.getHttpServer())
        .post('/buildings')
        .set('Cookie', await admin())
        .send(body)
        .expect(201);

      expect(stub.create).toHaveBeenCalledWith(
        expect.objectContaining({ aliases: [] }),
      );
    });

    it('refuses coordinates outside the campus, naming each axis (F1.2.7)', async () => {
      const response = await request(app.getHttpServer())
        .post('/buildings')
        .set('Cookie', await admin())
        .send({ ...validBody(), coordinates: { latitude: 5, longitude: 10 } })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(
        response.body.violations.map((v: { field: string }) => v.field),
      ).toEqual(['coordinates.latitude', 'coordinates.longitude']);
      expect(stub.create).not.toHaveBeenCalled();
    });

    it('lists every problem at once', async () => {
      const response = await request(app.getHttpServer())
        .post('/buildings')
        .set('Cookie', await admin())
        .send({
          canonicalName: '',
          shortName: 'x'.repeat(21),
          aliases: [''],
          coordinates: { latitude: 'north', longitude: 103.78 },
          id: randomUUID(),
        })
        .expect(400);

      expect(
        new Set(
          response.body.violations.map((v: { field: string }) => v.field),
        ),
      ).toEqual(
        new Set([
          'canonicalName',
          'shortName',
          'aliases',
          'coordinates.latitude',
          'id',
        ]),
      );
      expect(stub.create).not.toHaveBeenCalled();
    });

    it('answers 409 when a name belongs to another building (F4.2)', async () => {
      stub.create.mockRejectedValueOnce(
        new ConflictException({
          code: 'DUPLICATE_NAME',
          message: 'A building already uses "COM2".',
        }),
      );

      const response = await request(app.getHttpServer())
        .post('/buildings')
        .set('Cookie', await admin())
        .send(validBody())
        .expect(409);

      expect(response.body.code).toBe('DUPLICATE_NAME');
    });
  });

  describe('edit (F4.3)', () => {
    it('lets an admin rename a building and replace its aliases', async () => {
      await request(app.getHttpServer())
        .patch(`/buildings/${BUILDING_ID}`)
        .set('Cookie', await admin())
        .send({ shortName: ' C2 ', aliases: ['Com 2'] })
        .expect(200);

      expect(stub.updateNames).toHaveBeenCalledWith(
        BUILDING_ID,
        expect.objectContaining({ shortName: 'C2', aliases: ['Com 2'] }),
      );
    });

    it('refuses an empty body', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/buildings/${BUILDING_ID}`)
        .set('Cookie', await admin())
        .send({})
        .expect(400);

      expect(response.body.violations).toEqual([
        { field: '', reason: 'at least one field must be supplied' },
      ]);
      expect(stub.updateNames).not.toHaveBeenCalled();
    });

    it('refuses coordinates and unknown fields, and a malformed id', async () => {
      const cookie = await admin();
      await request(app.getHttpServer())
        .patch(`/buildings/${BUILDING_ID}`)
        .set('Cookie', cookie)
        .send({ coordinates: { latitude: 1.29, longitude: 103.78 } })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/buildings/not-a-uuid')
        .set('Cookie', cookie)
        .send({ shortName: 'C2' })
        .expect(400);
      expect(stub.updateNames).not.toHaveBeenCalled();
    });
  });

  describe('retire (F4.3, F4.3.1)', () => {
    it('lets an admin retire a building', async () => {
      await request(app.getHttpServer())
        .post(`/buildings/${BUILDING_ID}/retire`)
        .set('Cookie', await admin())
        .expect(200);

      expect(stub.retire).toHaveBeenCalledWith(BUILDING_ID);
    });

    it('refuses a malformed id', async () => {
      await request(app.getHttpServer())
        .post('/buildings/not-a-uuid/retire')
        .set('Cookie', await admin())
        .expect(400);

      expect(stub.retire).not.toHaveBeenCalled();
    });
  });
});
