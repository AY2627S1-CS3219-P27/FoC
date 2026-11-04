import { generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { FocAuthModule } from '@foc/auth';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import request from 'supertest';
import {
  configureHttp,
  OPENAPI_DOCUMENT_PATH,
} from '../http/configure-http.js';
import {
  Subscription,
  SubscriptionChannel,
  SubscriptionStatus,
} from '../database/entities/subscription.entity.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const endpoint = 'https://fcm.googleapis.com/fcm/send/dV3n4X0EXAMPLE';
const body = {
  endpoint,
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  expirationTime: null,
};

const subscription: Subscription = {
  id: '33333333-3333-4333-8333-333333333333',
  userId,
  channel: SubscriptionChannel.WebPush,
  endpoint,
  credentials: { p256dh: 'p256dh-value', auth: 'auth-value' },
  expirationTime: null,
  status: SubscriptionStatus.Active,
  deactivatedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('SubscriptionsController', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const signer = new JwtService({
    privateKey,
    signOptions: {
      algorithm: 'RS256',
      issuer: ACCESS_TOKEN_ISSUER,
      expiresIn: 900,
    },
  });
  const registerWebPush = vi.fn();
  const deactivateWebPush = vi.fn();
  let app: INestApplication;

  const accessToken = (sub = userId) =>
    signer.signAsync({
      sub,
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
    });

  beforeEach(async () => {
    registerWebPush.mockReset();
    deactivateWebPush.mockReset();
    registerWebPush.mockResolvedValue({ created: true, subscription });
    deactivateWebPush.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      imports: [FocAuthModule.register({ publicKey })],
      controllers: [SubscriptionsController],
      providers: [
        {
          provide: SubscriptionsService,
          useValue: { registerWebPush, deactivateWebPush },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a new endpoint with 201 and a Location header', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send(body)
      .expect(201);

    expect(response.headers.location).toBe(
      `/v1/subscriptions/web?endpoint=${encodeURIComponent(endpoint)}`,
    );
    expect(response.body).toEqual({
      id: subscription.id,
      endpoint,
      channel: SubscriptionChannel.WebPush,
      status: SubscriptionStatus.Active,
      expirationTime: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response.body).not.toHaveProperty('credentials');
    expect(registerWebPush).toHaveBeenCalledWith(userId, body);
  });

  it('returns 200 when the endpoint was already known', async () => {
    registerWebPush.mockResolvedValue({ created: false, subscription });

    const response = await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send(body)
      .expect(200);

    expect(response.headers.location).toBeUndefined();
  });

  it('accepts the access token cookie', async () => {
    await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${await accessToken()}`)
      .send(body)
      .expect(201);

    expect(registerWebPush).toHaveBeenCalledWith(userId, body);
  });

  it('deactivates the authenticated user’s endpoint with 204', async () => {
    const response = await request(app.getHttpServer())
      .delete('/v1/subscriptions/web')
      .query({ endpoint })
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(204);

    expect(response.text).toBe('');
    expect(deactivateWebPush).toHaveBeenCalledWith(userId, endpoint);
  });

  it('rejects unknown endpoints idempotently (204 through the service)', async () => {
    await request(app.getHttpServer())
      .delete('/v1/subscriptions/web')
      .query({ endpoint })
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(204);

    expect(deactivateWebPush).toHaveBeenCalledTimes(1);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .send(body)
      .expect(401, {
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Invalid access token',
      });

    expect(registerWebPush).not.toHaveBeenCalled();
  });

  it('rejects a non-https endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ ...body, endpoint: 'http://example.com/push' })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
    expect(registerWebPush).not.toHaveBeenCalled();
  });

  it('rejects an unknown subscription field', async () => {
    await request(app.getHttpServer())
      .post('/v1/subscriptions/web')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ ...body, userId: '22222222-2222-4222-8222-222222222222' })
      .expect(400);

    expect(registerWebPush).not.toHaveBeenCalled();
  });

  it('rejects a delete without the endpoint query parameter', async () => {
    await request(app.getHttpServer())
      .delete('/v1/subscriptions/web')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(400);

    expect(deactivateWebPush).not.toHaveBeenCalled();
  });

  it('publishes both routes in the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    expect(response.body.paths).toMatchObject({
      '/v1/subscriptions/web': {
        post: expect.any(Object),
        delete: expect.any(Object),
      },
    });
  });
});
