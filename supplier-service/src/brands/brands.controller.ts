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
import type { Brand } from '../database/entities/index.js';
import { BrandsService } from './brands.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { RenameBrandDto } from './dto/rename-brand.dto.js';

export interface BrandView {
  id: string;
  name: string;
}

function toView(brand: Brand): BrandView {
  return { id: brand.id, name: brand.name };
}

/**
 * Every route requires a valid user-service access token (F13.2). Guards run
 * before validation and the handler, so a denied caller gets 401/403 and no
 * part of the operation runs (F13.5).
 */
@Controller('brands')
@UseGuards(JwtAuthGuard)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  /** Non-retired brands, for any authenticated user (F3.5, F13.3). */
  @Get()
  async list(): Promise<BrandView[]> {
    return (await this.brands.listActive()).map(toView);
  }

  /** Admin only (F3.3); a duplicate name is 409 DUPLICATE_NAME (F3.2). */
  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: CreateBrandDto): Promise<BrandView> {
    return toView(await this.brands.create(body.name));
  }

  /**
   * Renames a brand (F3.3). Admin only. A name used by another non-retired
   * brand is 409 DUPLICATE_NAME (F3.2), a retired brand cannot be renamed
   * (409), an unknown id is 404.
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async rename(
    @Param('id', uuidParam('id')) id: string,
    @Body() body: RenameBrandDto,
  ): Promise<BrandView> {
    return toView(await this.brands.rename(id, body.name));
  }

  /**
   * Retires a brand (F3.3, F3.3.1). Admin only. Suppliers keep it, but it is
   * no longer listed or selectable. Retiring twice is harmless.
   */
  @Post(':id/retire')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async retire(@Param('id', uuidParam('id')) id: string): Promise<BrandView> {
    return toView(await this.brands.retire(id));
  }
}
