import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './http/configure-http.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureHttp(app);
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
