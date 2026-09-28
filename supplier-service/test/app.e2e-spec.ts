import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsString, Length } from 'class-validator';
import request from 'supertest';
import { DataSource, QueryFailedError } from 'typeorm';
import { seedTestEnvironment } from './test-env.js';

class ProbeDto {
  @IsString()
  @Length(1, 100)
  name: string;
}

// Test-only routes that exercise the global pipe and filter end to end,
// since the scaffold has no feature endpoints yet.
@Controller('__probe')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto) {
    return body;
  }

  @Get('db-down')
  dbDown() {
    throw new QueryFailedError(
      'SELECT 1',
      [],
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      }),
    );
  }
}

// The database is stubbed out here; DB-backed e2e specs arrive with the data
// model (step 3) and run against the compose test database
// (npm run db:test:up).
describe('supplier-service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // ConfigModule.forRoot validates the environment eagerly when the
    // AppModule decorator evaluates, before provider overrides apply — so the
    // module must be imported only after seeding, never statically at the top
    // of this file.
    seedTestEnvironment();
    const { AppModule } = await import('../src/app.module.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      // The TypeORM DataSource factory would otherwise try to reach Postgres
      // during app.init().
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the service is up', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('unknown routes return the standard error body', async () => {
    const response = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  it('lists every invalid and unknown field in one 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/__probe')
      .send({ name: '', version: 2 })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(response.body.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name' }),
        { field: 'version', reason: 'property version should not exist' },
      ]),
    );
  });

  it('rejects a malformed JSON body with a 400 in the standard shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/__probe')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'BAD_REQUEST',
    });
  });

  it('rejects an oversized body with 413, not 500', async () => {
    const response = await request(app.getHttpServer())
      .post('/__probe')
      .send({ name: 'x'.repeat(200_000) })
      .expect(413);

    expect(response.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers 503 with Retry-After when the database is unreachable', async () => {
    const response = await request(app.getHttpServer())
      .get('/__probe/db-down')
      .expect(503);

    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
  });
});
