import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  type EnvironmentVariables,
  logLevelsUpTo,
} from './config/environment.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(logLevelsUpTo(config.get('LOG_LEVEL', { infer: true })));
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
