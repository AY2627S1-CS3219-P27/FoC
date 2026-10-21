import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
} from '@foc/observability';

async function bootstrap() {
  initTelemetry({ serviceName: 'user-service' });

  // Imported after initTelemetry: the app module graph pulls in amqplib and
  // express, and ESM evaluates that graph before this file's body runs, so a
  // static import would be cached before the SDK registers and never traced.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  initMetrics();
  app.use('/metrics', createMetricsHandler());
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
