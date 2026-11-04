import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  createMetricsHandler,
  initMetrics,
  initTelemetry,
  registerShutdown,
} from '@foc/observability';
import { configureHttp } from './http/configure-http.js';

async function bootstrap(): Promise<void> {
  const telemetry = initTelemetry({ serviceName: 'comms-service' });
  const { Logger } = await import('nestjs-pino');
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  registerShutdown(app, telemetry);
  app.useLogger(app.get(Logger));

  configureHttp(app);
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  const config = app.get(ConfigService);
  const { ChatSocketIoAdapter } =
    await import('./socket/chat-socket.adapter.js');
  app.useWebSocketAdapter(new ChatSocketIoAdapter(app, config));
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

await bootstrap();
