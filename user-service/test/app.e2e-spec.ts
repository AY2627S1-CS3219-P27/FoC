import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { REDIS } from '../src/redis/redis.provider.js';
import { SecretService } from '../src/secret/secret.service.js';

// TODO(e2e): Replace this smoke test with real endpoint coverage once the
// OTP/account APIs are finalised and a test Redis container is available.
// Booting the full AppModule now pulls in RedisProvider/SecretService (which
// read env-configured secrets) and registers the Observe agent, so this is
// deliberately limited to verifying the app boots.
describe('user-service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS)
      .useValue({})
      .overrideProvider(SecretService)
      .useValue({
        getServerSecret: () => 'test-server-secret',
        getDbPassword: () => 'test-db-password',
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
