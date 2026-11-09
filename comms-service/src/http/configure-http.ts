import {
  BadRequestException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import { chatApiMetricsMiddleware } from '../observability/comms-metrics.js';
import { SanitizedExceptionFilter } from './sanitized-exception.filter.js';

export const OPENAPI_DOCUMENT_PATH = '/docs-json';
export const SWAGGER_UI_PATH = '/docs';
export const BEARER_SECURITY_SCHEME = 'bearer';
export const ACCESS_TOKEN_COOKIE_SECURITY_SCHEME = 'access-token-cookie';

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
  app.use(chatApiMetricsMiddleware);
  app.use(cookieParser());
  app.useGlobalFilters(new SanitizedExceptionFilter());
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

  const config = new DocumentBuilder()
    .setTitle('Friend on Campus Communication Service')
    .setDescription(
      'Communication Service health and authenticated participant chat reads',
    )
    .setVersion('1.0')
    .addTag('health', 'Process and dependency probes')
    .addTag('chats', 'Authenticated participant chat reads')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER_SECURITY_SCHEME,
    )
    .addCookieAuth(
      'access_token',
      undefined,
      ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}
