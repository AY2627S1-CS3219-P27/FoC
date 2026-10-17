import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import {
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
  BEARER_SECURITY_SCHEME,
  configureHttp,
  OPENAPI_DOCUMENT_PATH,
  SWAGGER_UI_PATH,
} from './configure-http.js';

class ValidationProbeDto {
  @IsString()
  label!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;
}

@Controller('http-infrastructure-probe')
class HttpInfrastructureProbeController {
  @Post()
  validate(@Body() body: ValidationProbeDto): ValidationProbeDto {
    return body;
  }

  @Get('cookie')
  cookie(@Req() request_: Request): { accessToken: unknown } {
    return { accessToken: request_.cookies.access_token };
  }
}

describe('configureHttp', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HttpInfrastructureProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('parses the access token cookie', async () => {
    await request(app.getHttpServer())
      .get('/http-infrastructure-probe/cookie')
      .set('Cookie', 'access_token=token-value')
      .expect(200, { accessToken: 'token-value' });
  });

  it('transforms valid DTO fields', async () => {
    await request(app.getHttpServer())
      .post('/http-infrastructure-probe')
      .send({ label: 'credits', amount: '5' })
      .expect(201, { label: 'credits', amount: 5 });
  });

  it('rejects unknown DTO fields instead of silently stripping them', async () => {
    const response = await request(app.getHttpServer())
      .post('/http-infrastructure-probe')
      .send({ label: 'credits', amount: 5, unexpected: true })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: [
        {
          field: 'unexpected',
          reason: 'property unexpected should not exist',
        },
      ],
    });
  });

  it('serves Swagger UI and the OpenAPI document', async () => {
    await request(app.getHttpServer()).get(SWAGGER_UI_PATH).expect(200);

    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    expect(response.body.info).toMatchObject({
      title: 'Friend on Campus Credit Service',
      version: '1.0',
    });
    expect(response.body.components.securitySchemes).toMatchObject({
      [BEARER_SECURITY_SCHEME]: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      [ACCESS_TOKEN_COOKIE_SECURITY_SCHEME]: {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
      },
    });
  });
});
