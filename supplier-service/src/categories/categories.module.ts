import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../database/entities/index.js';
import { CategoriesService } from './categories.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
