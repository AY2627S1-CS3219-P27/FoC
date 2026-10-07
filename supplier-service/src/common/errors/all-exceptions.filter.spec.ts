import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let adapter: {
    reply: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // The filter logs unexpected and dependency errors; keep test output clean.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    adapter = { reply: vi.fn(), setHeader: vi.fn() };
    filter = new AllExceptionsFilter({
      httpAdapter: adapter,
    } as unknown as HttpAdapterHost);
  });

  const host = {
    switchToHttp: () => ({ getResponse: () => 'response' }),
  } as never;

  it.each([
    [new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException('Supplier not found.'), 404, 'NOT_FOUND'],
    [new ConflictException(), 409, 'CONFLICT'],
  ])('derives a code from the status of %s', (exception, status, code) => {
    expect(filter.toBody(exception)).toMatchObject({
      statusCode: status,
      code,
    });
  });

  it('keeps a code and message chosen by the thrower', () => {
    const exception = new ConflictException({
      code: 'DUPLICATE_SUPPLIER',
      message: 'A supplier with this name already exists on this floor.',
    });

    expect(filter.toBody(exception)).toEqual({
      statusCode: 409,
      error: 'Conflict',
      code: 'DUPLICATE_SUPPLIER',
      message: 'A supplier with this name already exists on this floor.',
    });
  });

  it('keeps validation violations', () => {
    const exception = new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      violations: [{ field: 'name', reason: 'name must not be empty' }],
    });

    expect(filter.toBody(exception)).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      violations: [{ field: 'name', reason: 'name must not be empty' }],
    });
  });

  it('turns an unreachable database into a retryable 503, never a 404', () => {
    const exception = new QueryFailedError(
      'SELECT',
      [],
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );

    filter.catch(exception, host);

    expect(adapter.setHeader).toHaveBeenCalledWith(
      'response',
      'Retry-After',
      '1',
    );
    expect(adapter.reply).toHaveBeenCalledWith(
      'response',
      expect.objectContaining({
        statusCode: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      }),
      503,
    );
  });

  it('keeps the 413 of an oversized body instead of reporting a 500', () => {
    const parserError = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    expect(filter.toBody(parserError)).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large.',
    });
  });

  it('hides the details of unexpected errors', () => {
    const body = filter.toBody(new Error('secret connection string leaked'));

    expect(body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  it('does not treat a constraint violation as a dependency failure', () => {
    const exception = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    expect(filter.toBody(exception)).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(filter.toBody(exception).retryable).toBeUndefined();
  });
});
