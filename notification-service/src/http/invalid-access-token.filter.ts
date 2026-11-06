import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Maps the shared guard's 401 onto the service's stable error envelope, so
 * clients see the same `INVALID_ACCESS_TOKEN` shape every service returns.
 */
@Catch(UnauthorizedException)
export class InvalidAccessTokenFilter implements ExceptionFilter {
  catch(_exception: UnauthorizedException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(401).json({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    });
  }
}
