import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
} from '@foc/observability';

async function bootstrap() {
  initTelemetry({ serviceName: 'user-service' });
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  initMetrics();
  app.use('/metrics', createMetricsHandler());
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
