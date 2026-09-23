import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { REDIS } from '../src/redis/redis.provider.js';
import { SecretService } from '../src/secret/secret.service.js';
import { seedTestEnvironment } from './test-env.js';

// TODO(e2e): Replace this smoke test with real endpoint coverage once the
// OTP/account APIs are finalised and a test Redis/Postgres container is
// available. Booting the full AppModule now pulls in RedisProvider/SecretService
// (which read env-configured secrets), the TypeORM DataSource and the Observe
// agent, so this is deliberately limited to verifying the app boots with the
// heavy providers stubbed out.
describe('user-service (e2e)', () => {
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
    })
      .overrideProvider(REDIS)
      .useValue({})
      // The TypeORM DataSource factory would otherwise try to reach the
      // Postgres container during app.init(); the stub only needs to satisfy
      // the repository providers that inject it.
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .overrideProvider(SecretService)
      .useValue({
        getServerSecret: () => 'test-server-secret',
        getDbPassword: () => 'test-db-password',
        getRabbitMqPassword: () => 'test-rabbitmq-password',
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots the application', () => {
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });
});