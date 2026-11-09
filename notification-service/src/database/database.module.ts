import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDatabaseOptions, databaseEntities } from './database-options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createDatabaseOptions({
          DB_HOST: config.getOrThrow('DB_HOST'),
          DB_PORT: config.getOrThrow('DB_PORT'),
          DB_USERNAME: config.getOrThrow('DB_USERNAME'),
          DB_DATABASE: config.getOrThrow('DB_DATABASE'),
          DB_PASSWORD_FILE: config.getOrThrow('DB_PASSWORD_FILE'),
          DB_MIGRATIONS_RUN: config.get<boolean>('DB_MIGRATIONS_RUN') ?? true,
        }),
    }),
    TypeOrmModule.forFeature(databaseEntities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
