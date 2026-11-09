import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttp, OPENAPI_DOCUMENT_PATH } from './configure-http.js';
import { AuthController } from '../auth/auth.controller.js';
import { OtpController } from '../otp/otp.controller.js';
import { UsersController } from '../users/users.controller.js';
import { PasswordResetController } from '../password-reset/password-reset.controller.js';
import { HealthController } from '../health/health.controller.js';

describe('openapi document', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AuthController,
        OtpController,
        UsersController,
        PasswordResetController,
        HealthController,
      ],
    })
      .useMocker((token) => {
        if (token === ConfigService) return { get: () => 'development' };
        return {};
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every controller route with tags and examples', async () => {
    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    const doc = response.body;
    expect(Object.keys(doc.paths).sort()).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/sessions/current',
        '/auth/sessions',
        '/auth/refresh',
        '/otp',
        '/otp/validate',
        '/users',
        '/users/me',
        '/users/me/roles',
        '/users/me/archive',
        '/users/{uuid}',
        '/password-reset/request',
        '/password-reset/confirm',
        '/health',
      ]),
    );

    const tags = new Set<string>();
    for (const path of Object.values<any>(doc.paths)) {
      for (const op of Object.values<any>(path)) {
        tags.add(op.tags[0]);
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      }
    }
    expect([...tags].sort()).toEqual([
      'auth',
      'health',
      'otp',
      'password-reset',
      'users',
    ]);

    // Examples really made it into the document.
    expect(
      doc.paths['/users'].get.responses['200'].content['application/json']
        .example,
    ).toMatchObject({ total: 42 });
    expect(doc.paths['/auth/refresh'].post.security).toContainEqual({
      refresh_token: [],
    });
    expect(doc.paths['/users'].get.security).toEqual(
      expect.arrayContaining([{ access_token: [] }, { bearer: [] }]),
    );
  });
});
