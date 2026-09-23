import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountInitializationModule } from './account-initialization/account-initialization.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { environmentSchema } from './config/environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    AccountInitializationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
