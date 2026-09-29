import { AdminGuard, type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseIfMatch } from '../common/validation/if-match.js';
import { uuidParam } from '../common/validation/parse-uuid.pipe.js';
import type { Page } from '../suppliers/supplier-view.js';
import { DenyRequestDto } from './dto/deny-request.dto.js';
import { ListMyRequestsQueryDto } from './dto/list-my-requests-query.dto.js';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import { SubmitUpdateRequestDto } from './dto/submit-update-request.dto.js';
import type { RequestView } from './request-view.js';
import { SupplierRequestsService } from './supplier-requests.service.js';

/**
 * Every route requires a valid access token (F13.2). Any authenticated user
 * may file requests (F13.3), and follow and withdraw their own (F6.5, F6.6);
 * the Pending queue, approving and denying are admin-only (F13.4). The
 * acting user's id comes only from the token (F13.1).
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

  /**
   * Files a request to edit a supplier (F8.1), based on the version in
   * If-Match, as for an admin edit: missing → 428, out of date → 409.
   */
  @Post('updates')
  submitUpdate(
    @Body() body: SubmitUpdateRequestDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.submitUpdate(
      body.supplierId,
      parseIfMatch(ifMatch),
      body.changes,
      String(request.user.sub),
    );
  }

  /** Pending requests, oldest first (F6.7). */
  @Get()
  @UseGuards(AdminGuard)
  listPending(
    @Query() query: ListRequestsQueryDto,
  ): Promise<Page<RequestView>> {
    return this.requests.listPending(query);
  }

  /**
   * The caller's own requests of every type and state, newest first
   * (F6.5). Declared before `:id` so `mine` is not read as an id.
   */
  @Get('mine')
  listMine(
    @Query() query: ListMyRequestsQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Page<RequestView>> {
    return this.requests.listMine(String(request.user.sub), query);
  }

  /** One request, for its submitter or an admin; anyone else 404 (F13.6). */
  @Get(':id')
  get(
    @Param('id', uuidParam('id')) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.get(id, {
      id: String(request.user.sub),
      isAdmin: request.user.isAdmin,
    });
  }

  /** Withdraws the caller's own Pending request (F6.6). */
  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('id', uuidParam('id')) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestView> {
    return this.requests.withdraw(id, String(request.user.sub));
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
