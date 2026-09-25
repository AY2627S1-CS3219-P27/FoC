import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

export const OPENAPI_DOCUMENT_PATH = '/docs-json';
export const SWAGGER_UI_PATH = '/docs';
export const BEARER_SECURITY_SCHEME = 'bearer';
export const ACCESS_TOKEN_COOKIE_SECURITY_SCHEME = 'access_token';

export function configureHttp(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Friend on Campus Credit Service')
    .setDescription('Credit balance and advisory sufficiency APIs')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token supplied as an Authorization bearer token',
      },
      BEARER_SECURITY_SCHEME,
    )
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
      {
        type: 'apiKey',
        in: 'cookie',
        description: 'Access token supplied in the access_token cookie',
      },
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);

  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}
