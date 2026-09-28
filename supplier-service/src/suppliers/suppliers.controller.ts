import { JwtAuthGuard } from '@foc/auth';
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import { SupplierQueriesService } from './supplier-queries.service.js';
import type {
  Page,
  SupplierDetail,
  SupplierListItem,
} from './supplier-view.js';

/**
 * Every route requires a valid user-service access token (F13.2); reading
 * is open to any authenticated user (F13.3).
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private readonly queries: SupplierQueriesService) {}

  /** List, search, filter, sort and paginate (F5, N3.1). */
  @Get()
  list(@Query() query: ListSuppliersQueryDto): Promise<Page<SupplierListItem>> {
    return this.queries.list(query);
  }

  /**
   * One supplier (F5.9). The version is also sent as the ETag, which an
   * admin edit must send back in If-Match (F14.3, step 6).
   */
  @Get(':id')
  async get(
    @Param('id', uuidParam('id')) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierDetail> {
    const supplier = await this.queries.get(id);
    response.setHeader('ETag', `"${supplier.version}"`);
    return supplier;
  }
}
