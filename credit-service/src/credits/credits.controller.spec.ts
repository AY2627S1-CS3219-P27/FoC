import { generateKeyPairSync } from 'node:crypto';
import { type INestApplication, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { FocAuthModule } from '@foc/auth';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_ISSUER, Role } from '@foc/contracts';
import request from 'supertest';
import {
  configureHttp,
  OPENAPI_DOCUMENT_PATH,
} from '../http/configure-http.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';
import { CreditsController } from './credits.controller.js';

describe('CreditsController', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
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
  const getBalance = vi.fn();
  let app: INestApplication;

  const accessToken = (sub = userId, roles: Role[] = [Role.Requester]) =>
    signer.signAsync({
      sub,
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles,
    });

  beforeEach(async () => {
    getBalance.mockReset();
    getBalance.mockResolvedValue({
      userId,
      creditBalance: 100,
      reservedBalance: 20,
    });

    const module = await Test.createTestingModule({
      imports: [FocAuthModule.register({ publicKey })],
      controllers: [CreditsController],
      providers: [
        {
          provide: CreditAccountQueryService,
          useValue: { getBalance },
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

  it('returns the authenticated user balance for a bearer token', async () => {
    const token = await accessToken();

    await request(app.getHttpServer())
      .get('/v1/credits/balance')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, {
        userId,
        creditBalance: 100,
        reservedBalance: 20,
      });

    expect(getBalance).toHaveBeenCalledExactlyOnceWith(userId);
  });

  it('accepts a role-less user through the shared access-token cookie', async () => {
    const token = await accessToken(userId, []);

    await request(app.getHttpServer())
      .get('/v1/credits/balance')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${token}`)
      .expect(200);
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-jwt'],
  ])('returns the stable 401 response for a %s token', async (_case, token) => {
    const call = request(app.getHttpServer()).get('/v1/credits/balance');
    if (token) {
      call.set('Authorization', `Bearer ${token}`);
    }

    await call.expect(401, {
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    });
    expect(getBalance).not.toHaveBeenCalled();
  });

  it('returns the centralized missing-account error', async () => {
    getBalance.mockRejectedValue(
      new NotFoundException({
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      }),
    );

    await request(app.getHttpServer())
      .get('/v1/credits/balance')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .expect(404, {
        code: 'CREDIT_ACCOUNT_NOT_FOUND',
        message: 'Credit account not found',
      });
  });

  it.each([
    [100, true],
    [101, false],
  ])('reports sufficiency for amount %i', async (amount, sufficient) => {
    await request(app.getHttpServer())
      .post('/v1/credits/sufficiency')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ userId, amount })
      .expect(200, { userId, amount, sufficient });

    expect(getBalance).toHaveBeenCalledExactlyOnceWith(userId);
  });

  it('rejects a request for another user before querying an account', async () => {
    await request(app.getHttpServer())
      .post('/v1/credits/sufficiency')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ userId: otherUserId, amount: 50 })
      .expect(403, {
        code: 'SUBJECT_MISMATCH',
        message: 'Requested user does not match authenticated user',
      });

    expect(getBalance).not.toHaveBeenCalled();
  });

  it('rejects a malformed user UUID before querying an account', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/credits/sufficiency')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ userId: 'not-a-uuid', amount: 50 })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: expect.arrayContaining([
        expect.objectContaining({ field: 'userId' }),
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain('not-a-uuid');
    expect(getBalance).not.toHaveBeenCalled();
  });

  it('returns sanitized validation reasons and rejects unknown fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/credits/sufficiency')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({ userId, amount: 0, token: 'do-not-echo' })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: expect.arrayContaining([
        expect.objectContaining({ field: 'amount' }),
        expect.objectContaining({ field: 'token' }),
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain('do-not-echo');
    expect(getBalance).not.toHaveBeenCalled();
  });

  it('publishes endpoint schemas, responses, and alternative security inputs', async () => {
    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    expect(response.body.paths['/v1/credits/balance'].get).toMatchObject({
      security: expect.arrayContaining([{ bearer: [] }, { access_token: [] }]),
      responses: {
        200: expect.any(Object),
        401: expect.any(Object),
        404: expect.any(Object),
      },
    });
    expect(response.body.paths['/v1/credits/sufficiency'].post).toMatchObject({
      security: expect.arrayContaining([{ bearer: [] }, { access_token: [] }]),
      responses: {
        200: expect.any(Object),
        400: expect.any(Object),
        401: expect.any(Object),
        403: expect.any(Object),
        404: expect.any(Object),
      },
    });
    expect(
      response.body.paths['/v1/credits/balance'].get.responses['401'].content[
        'application/json'
      ].example,
    ).toEqual({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    });
    expect(
      response.body.paths['/v1/credits/sufficiency'].post.responses['403']
        .content['application/json'].example,
    ).toEqual({
      code: 'SUBJECT_MISMATCH',
      message: 'Requested user does not match authenticated user',
    });
    expect(
      response.body.paths['/v1/credits/balance'].get.responses['200'].content[
        'application/json'
      ].example,
    ).toEqual({ userId, creditBalance: 100, reservedBalance: 0 });
    expect(
      response.body.paths['/v1/credits/sufficiency'].post.requestBody.content[
        'application/json'
      ].examples,
    ).toMatchObject({
      sufficient: { value: { userId, amount: 50 } },
      insufficient: { value: { userId, amount: 150 } },
    });
    expect(response.body.tags).toContainEqual(
      expect.objectContaining({ name: 'credits' }),
    );
  });
});
