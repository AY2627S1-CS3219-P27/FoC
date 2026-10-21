import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import {
  type EnvironmentVariables,
  logLevelsUpTo,
} from './config/environment.schema.js';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
} from '@foc/observability';

async function bootstrap(): Promise<void> {
  initTelemetry({ serviceName: 'supplier-service' });
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(logLevelsUpTo(config.get('LOG_LEVEL', { infer: true })));
  app.enableShutdownHooks();
  app.use(cookieParser());
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
