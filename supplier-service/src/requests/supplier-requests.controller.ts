import { AdminGuard, type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import type { Page } from '../suppliers/supplier-view.js';
import { DenyRequestDto } from './dto/deny-request.dto.js';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import type { RequestView } from './request-view.js';
import { SupplierRequestsService } from './supplier-requests.service.js';

/**
 * Every route requires a valid access token (F13.2). Any authenticated user
 * may file requests (F13.3); listing, approving and denying are admin-only
 * (F13.4). The acting user's id comes only from the token (F13.1).
 */
@Controller('supplier-requests')
@UseGuards(JwtAuthGuard)
export class SupplierRequestsController {
  constructor(private readonly requests: SupplierRequestsService) {}

  /**
   * Files a request to add a supplier (F7.1). The body is the same as for
   * POST /suppliers, passed to the service unvalidated so field and reference
   * problems come back together in one 400 (F1.6.1).
   */
  @Post('creations')
  submitCreation(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.submitCreation(body, String(request.user.sub));
  }

  /** Pending requests, oldest first (F6.7). */
  @Get()
  @UseGuards(AdminGuard)
  listPending(
    @Query() query: ListRequestsQueryDto,
  ): Promise<Page<RequestView>> {
    return this.requests.listPending(query);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  approve(
    @Param('id', uuidParam('id')) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.approve(id, String(request.user.sub));
  }

  @Post(':id/deny')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  deny(
    @Param('id', uuidParam('id')) id: string,
    @Body() body: DenyRequestDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.deny(id, String(request.user.sub), body.reason);
  }
}
