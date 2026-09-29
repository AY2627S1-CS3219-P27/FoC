import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { parseIfMatch } from '../common/validation/if-match.js';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import { ChangeSupplierStatusDto } from './dto/change-supplier-status.dto.js';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import { SupplierQueriesService } from './supplier-queries.service.js';
import type {
  Page,
  SupplierDetail,
  SupplierListItem,
} from './supplier-view.js';
import { SuppliersService } from './suppliers.service.js';

/**
 * Every route requires a valid user-service access token (F13.2). Reading is
 * open to any authenticated user (F13.3); direct changes are admin-only
 * (F13.4), and a basic user gets 403 with no part of the change performed
 * (F13.5).
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(
    private readonly queries: SupplierQueriesService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** List, search, filter, sort and paginate (F5, N3.1). */
  @Get()
  list(@Query() query: ListSuppliersQueryDto): Promise<Page<SupplierListItem>> {
    return this.queries.list(query);
  }

  /**
   * One supplier (F5.9). The version is also sent as the ETag, which an
   * admin edit must send back in If-Match (F14.3).
   */
  @Get(':id')
  async get(
    @Param('id', uuidParam('id')) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierDetail> {
    return this.withEtag(response, await this.queries.get(id));
  }

  /**
   * Creates an Active supplier directly, without a request (F7.5). The body
   * is passed to the service unvalidated so that field rules and reference
   * checks (does the building exist?) come back in one 400 (F1.6.1).
   */
  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierDetail> {
    const { id } = await this.suppliers.create(body);
    response.setHeader('Location', `/suppliers/${id}`);
    return this.withEtag(response, await this.queries.get(id));
  }

  /**
   * Edits one or more fields directly (F8.6), based on the version in
   * If-Match (F14.3): missing → 428, out of date → 409 with currentVersion.
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', uuidParam('id')) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierDetail> {
    await this.suppliers.update(id, parseIfMatch(ifMatch), body);
    return this.withEtag(response, await this.queries.get(id));
  }

  /**
   * Activates or deactivates directly (F9.5), based on the version in
   * If-Match (F14.3). Deactivating is D2's "delete": the supplier stays,
   * tagged Inactive, and can be reactivated.
   */
  @Put(':id/status')
  @UseGuards(AdminGuard)
  async changeStatus(
    @Param('id', uuidParam('id')) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: ChangeSupplierStatusDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SupplierDetail> {
    await this.suppliers.changeStatus(id, parseIfMatch(ifMatch), body.status);
    return this.withEtag(response, await this.queries.get(id));
  }

  private withEtag(
    response: Response,
    supplier: SupplierDetail,
  ): SupplierDetail {
    response.setHeader('ETag', `"${supplier.version}"`);
    return supplier;
  }
}
