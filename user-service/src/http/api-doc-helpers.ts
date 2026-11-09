import type { Type } from '@nestjs/common';
import { getSchemaPath } from '@nestjs/swagger';
import { ApiErrorDto } from './api-error.dto.js';

export const EXAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';
export const EXAMPLE_NUS_EMAIL = 'alex.teo@u.nus.edu';

/** OpenAPI response entry for a JSON success body. */
export function successResponse(
  model: Type<unknown>,
  description: string,
  example: Record<string, unknown>,
) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(model) },
        example,
      },
    },
  };
}

/** OpenAPI response entry for a JSON error body (Nest default exception shape). */
export function errorResponse(
  description: string,
  example: Record<string, unknown>,
) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorDto) },
        example,
      },
    },
  };
}

/** Standard ValidationPipe failure body. */
export function validationErrorExample(
  reasons: string[] = ['email must be an email'],
): Record<string, unknown> {
  return {
    statusCode: 400,
    message: reasons,
    error: 'Bad Request',
  };
}
