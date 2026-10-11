import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { RabbitMqConsumerTransport } from './../src/messaging/rabbitmq-consumer.transport.js';
import { RABBITMQ_CONNECTION_URL } from './../src/messaging/rabbitmq-connection-url.provider.js';
import { OutboxRelay } from './../src/outbox/outbox.relay.js';
import { AuthKeyService } from './../src/auth/auth-key.service.js';
import { configureHttp } from './../src/http/configure-http.js';

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('Credit Service (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // HTTP smoke tests should not require a broker. Transport behavior has
      // its own real-RabbitMQ integration suite.
      .overrideProvider(RabbitMqConsumerTransport)
      .useValue({ subscribe: vi.fn(), close: vi.fn() })
      .overrideProvider(RABBITMQ_CONNECTION_URL)
      .useValue('amqp://unused')
      .overrideProvider(OutboxRelay)
      .useValue({ start: vi.fn(), close: vi.fn() })
      .overrideProvider(AuthKeyService)
      .useValue({ getJwtPublicKey: () => publicKey })
      .compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  it('/docs-json (GET)', () => {
    return request(app.getHttpServer())
      .get('/docs-json')
      .expect(200)
      .expect(({ body }) => {
        expect(body.paths['/v1/credits/balance']).toBeDefined();
        expect(body.paths['/v1/credits/sufficiency']).toBeDefined();
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
