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
  // Above the 60s maximum archive drain, below the 75s stop_grace_period in compose.yml.
  registerShutdown(app, telemetry, { closeTimeoutMs: 70_000 });
  app.useLogger(app.get(Logger));

  configureHttp(app);
  initMetrics();
  app.use('/metrics', createMetricsHandler());

  const config = app.get(ConfigService);
  const { SocketRedisAdapterService } =
    await import('./redis/socket-redis-adapter.service.js');
  const socketRedis = app.get(SocketRedisAdapterService);
  await socketRedis.connect();
  const { ChatSocketIoAdapter } =
    await import('./socket/chat-socket.adapter.js');
  app.useWebSocketAdapter(new ChatSocketIoAdapter(app, config, socketRedis));
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

await bootstrap();
