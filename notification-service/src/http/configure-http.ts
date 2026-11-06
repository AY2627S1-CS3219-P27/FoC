import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import { InvalidAccessTokenFilter } from './invalid-access-token.filter.js';

export const OPENAPI_DOCUMENT_PATH = '/docs-json';
export const SWAGGER_UI_PATH = '/docs';
export const BEARER_SECURITY_SCHEME = 'bearer';
export const ACCESS_TOKEN_COOKIE_SECURITY_SCHEME = 'access_token';

interface ValidationReason {
  field: string;
  reason: string;
}

function validationReasons(
  errors: ValidationError[],
  parent = '',
): ValidationReason[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const reasons = Object.values(error.constraints ?? {}).map((reason) => ({
      field,
      reason,
    }));
    return [...reasons, ...validationReasons(error.children ?? [], field)];
  });
}

/**
 * Shared HTTP infrastructure: cookie parsing (the access token arrives as an
 * httpOnly cookie first), the 401 envelope, the validating pipe with
 * field-level reasons, and the OpenAPI document. Mirrors credit-service so a
 * client sees the same error shapes and Swagger surface across services.
 */
export function configureHttp(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalFilters(new InvalidAccessTokenFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          reasons: validationReasons(errors),
        }),
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Friend on Campus Notification Service')
    .setDescription('Push notification subscription management APIs')
    .setVersion('1.0')
    .addTag(
      'subscriptions',
      'Authenticated management of a user\u2019s push notification endpoints',
    )
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
          'Preferred User Service access token input when both cookie and bearer credentials are present.',
      },
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);

  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}
