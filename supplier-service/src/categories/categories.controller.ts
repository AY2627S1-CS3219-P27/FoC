import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import type { Category } from '../database/entities/index.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { RenameCategoryDto } from './dto/rename-category.dto.js';

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

  /**
   * Renames a category (F11.2). Admin only. A name already used by a
   * non-retired category is 409 DUPLICATE_NAME (F11.2.1), a retired category
   * cannot be renamed (409), an unknown id is 404.
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async rename(
    @Param('id', uuidParam('id')) id: string,
    @Body() body: RenameCategoryDto,
  ): Promise<CategoryView> {
    return toView(await this.categories.rename(id, body.name));
  }

  /**
   * Retires a category (F11.2, F11.3). Admin only. Suppliers keep it, but it
   * is no longer listed or selectable (F11.3.1). Retiring twice is harmless.
   */
  @Post(':id/retire')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async retire(
    @Param('id', uuidParam('id')) id: string,
  ): Promise<CategoryView> {
    return toView(await this.categories.retire(id));
  }
}
