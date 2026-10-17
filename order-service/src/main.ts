import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureHttp } from './http/configure-http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureHttp(app);
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
}
await bootstrap();
