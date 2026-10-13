import { type INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

// HTTP setup shared by main.ts and tests, so tests run what production runs.
export function configureHttp(app: INestApplication): void {
  // Fills request.cookies: browsers send the access token as the httpOnly
  // `access_token` cookie, which JwtAuthGuard reads before the Bearer header.
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
