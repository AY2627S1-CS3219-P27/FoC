import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { configureHttp } from './http/configure-http.js';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
} from '@foc/observability';

async function bootstrap() {
  initTelemetry({ serviceName: 'order-service' });

  // Imported after initTelemetry: the app module graph pulls in amqplib and
  // express, and ESM evaluates that graph before this file's body runs, so a
  // static import would be cached before the SDK registers and never traced.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureHttp(app);
  app.enableShutdownHooks();
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
