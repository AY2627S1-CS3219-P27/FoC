import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

export const OPENAPI_DOCUMENT_PATH = '/docs-json';
export const SWAGGER_UI_PATH = '/docs';
export const BEARER_SECURITY_SCHEME = 'bearer';
export const ACCESS_TOKEN_COOKIE_SECURITY_SCHEME = 'access_token';
export const REFRESH_TOKEN_COOKIE_SECURITY_SCHEME = 'refresh_token';
export const REGISTRATION_TOKEN_COOKIE_SECURITY_SCHEME = 'registration_token';

export function configureHttp(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const openApiConfig = new DocumentBuilder()
    .setTitle('Friend on Campus User Service')
    .setDescription(
      'Registration with NUS email OTP, login, session refresh and ' +
        'revocation, profile reads and updates, admin account management, ' +
        'and password reset APIs',
    )
    .setVersion('1.0')
    .addTag('auth', 'Registration, login, session refresh and logout')
    .addTag('otp', 'NUS email OTP issuance and registration-token issuance')
    .addTag(
      'users',
      'Authenticated profile reads and updates, and admin account management',
    )
    .addTag('password-reset', 'Password reset request and confirmation')
    .addTag('health', 'Database-backed liveness probe')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'User Service access token. Used only when the access_token cookie is absent.',
      },
      BEARER_SECURITY_SCHEME,
    )
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Preferred access token input when both cookie and bearer credentials are present.',
      },
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE_SECURITY_SCHEME,
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Long-lived session cookie used to renew the access token.',
      },
      REFRESH_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .addCookieAuth(
      REGISTRATION_TOKEN_COOKIE_SECURITY_SCHEME,
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Short-lived cookie issued by POST /otp/validate and consumed by POST /auth/register.',
      },
      REGISTRATION_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);

  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}
