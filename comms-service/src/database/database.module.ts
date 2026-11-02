import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../config/environment.js';
import { createDatabaseOptions } from './database-options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        createDatabaseOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_DATABASE: config.get('DB_DATABASE', { infer: true }),
          DB_PASSWORD_FILE: config.get('DB_PASSWORD_FILE', { infer: true }),
        }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
