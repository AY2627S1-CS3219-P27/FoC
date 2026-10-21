import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {
  type EnvironmentVariables,
} from './config/environment.schema.js';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
  registerTelemetryShutdown,
} from '@foc/observability';

async function bootstrap(): Promise<void> {
  const telemetry = initTelemetry({ serviceName: 'supplier-service' });
  // Flush and stop the SDK on SIGINT/SIGTERM so the final batch of spans and
  // logs is exported before the process exits.
  registerTelemetryShutdown(telemetry);

  // nestjs-pino must load after initTelemetry: its pino logger is created
  // through the module PinoInstrumentation hooks, and a static import would
  // evaluate before the SDK registers (same ESM ordering rule as the
  // AppModule import below).
  const { Logger } = await import('nestjs-pino');

  // Imported after initTelemetry: the app module graph pulls in amqplib and
  // express, and ESM evaluates that graph before this file's body runs, so a
  // static import would be cached before the SDK registers and never traced.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(cookieParser());
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
