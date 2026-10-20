import { AdminGuard, JwtAuthGuard } from '@foc/auth';
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { MineErrandsQuery } from './errands.dto.js';
import { ErrandsQueryService } from './errands.query.js';

// Admin reads. Admin is the token's isAdmin flag, not a participant role, so
// AdminGuard replaces RolesGuard. Read-only: never calls transition().
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminErrandsController {
  constructor(private readonly queries: ErrandsQueryService) {}

  // A user's errands as requester or courier; same filters and paging as /mine.
  // An unknown user is an empty list: users live in user-service.
  @Get('users/:userId/errands')
  userErrands(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: MineErrandsQuery) {
    return this.queries.ofUserForAdmin(userId, query);
  }
}
