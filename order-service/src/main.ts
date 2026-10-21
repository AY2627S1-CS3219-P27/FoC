import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { configureHttp } from './http/configure-http.js';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
  registerTelemetryShutdown,
} from '@foc/observability';

async function bootstrap() {
  const telemetry = initTelemetry({ serviceName: 'order-service' });
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
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  configureHttp(app);
  app.enableShutdownHooks();
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
