import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from './categories.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async list() {
    const categories = await this.categoriesService.listActive();
    return {
      items: categories.map((c) => ({
        id: c.id,
        name: c.name,
      })),
    };
  }
}
