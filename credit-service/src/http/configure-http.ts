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
    .setTitle('Friend on Campus Credit Service')
    .setDescription('Credit balance and advisory sufficiency APIs')
    .setVersion('1.0')
    .addTag(
      'credits',
      'Authenticated, self-only balance reads and non-reserving sufficiency advice',
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
