import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { MineErrandsQuery, PageQuery } from './errands.dto.js';
import { ErrandsQueryService } from './errands.query.js';

// Admin is the token's isAdmin flag, not a participant role, hence no RolesGuard.
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminErrandsController {
  constructor(private readonly queries: ErrandsQueryService) {}

  @Get('users/:userId/errands')
  userErrands(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: MineErrandsQuery) {
    return this.queries.ofUserForAdmin(userId, query);
  }

  @Get('disputes')
  disputes(@Query() query: PageQuery) {
    return this.queries.disputeQueue(query);
  }

  @Get('disputes/:errandId')
  async dispute(@Param('errandId', ParseUUIDPipe) errandId: string) {
    const detail = await this.queries.disputeDetail(errandId);
    if (!detail) throw new NotFoundException();
    return detail;
  }
}
