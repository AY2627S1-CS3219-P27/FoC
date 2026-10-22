import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { configureHttp } from './http/configure-http.js';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
  registerShutdown,
} from '@foc/observability';

async function bootstrap(): Promise<void> {
  const telemetry = initTelemetry({ serviceName: 'credit-service' });

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
  // On SIGINT/SIGTERM: close the app (running its shutdown hooks), then flush
  // and stop the telemetry SDK before the process exits.
  registerShutdown(app, telemetry);
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  configureHttp(app);
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
