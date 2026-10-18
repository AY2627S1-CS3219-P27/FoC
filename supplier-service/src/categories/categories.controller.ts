import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { Category } from '../database/entities/index.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';

export interface CategoryView {
  id: string;
  name: string;
}

function toView(category: Category): CategoryView {
  return { id: category.id, name: category.name };
}

/**
 * Every route requires a valid user-service access token (F13.2). Guards run
 * before validation and the handler, so a denied caller gets 401/403 and no
 * part of the operation runs (F13.5).
 */
@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Non-retired categories, for any authenticated user (F11.4, F13.3). */
  @Get()
  async list(): Promise<CategoryView[]> {
    return (await this.categories.listActive()).map(toView);
  }

  /** Admin only (F11.2, F13.4); a duplicate name is 409 DUPLICATE_NAME. */
  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: CreateCategoryDto): Promise<CategoryView> {
    return toView(await this.categories.create(body.name));
  }
}
