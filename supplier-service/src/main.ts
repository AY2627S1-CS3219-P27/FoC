import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import {
  type EnvironmentVariables,
  logLevelsUpTo,
} from './config/environment.schema.js';

async function bootstrap(): Promise<void> {
  // Buffered until the configured logger is set, so startup logs (e.g. the
  // seed import) are not lost.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(logLevelsUpTo(config.get('LOG_LEVEL', { infer: true })));
  app.enableShutdownHooks();
  // Parses the Cookie header so @foc/auth's JwtAuthGuard can read the
  // access_token cookie set by user-service's login (as in user-service).
  app.use(cookieParser());

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
