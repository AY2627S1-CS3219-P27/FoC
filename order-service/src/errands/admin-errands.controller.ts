import { type AuthenticatedRequest, AdminGuard, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { admin } from '../lifecycle/transition.js';
import { MineErrandsQuery, PageQuery, ResolveDisputeDto } from './errands.dto.js';
import { ErrandsQueryService } from './errands.query.js';
import { resultToHttp } from './result-to-http.js';

// Rejected settlements allowed per errand in a rolling hour.
const MAX_REJECTIONS_PER_HOUR = 3;

// Admin is the token's isAdmin flag, not a participant role, hence no RolesGuard.
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminErrandsController {
  constructor(
    private readonly queries: ErrandsQueryService,
    private readonly lifecycle: LifecycleService,
  ) {}

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

  // Order: 404, 409 (not Incomplete), 400 (amount above the reward), 429; the
  // conditional UPDATE then settles a race between two admins as one 409.
  @Post('disputes/:errandId/resolve')
  @HttpCode(200)
  async resolve(
    @Param('errandId', ParseUUIDPipe) errandId: string,
    @Body() body: ResolveDisputeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const gate = await this.queries.resolveGate(errandId);
    if (!gate) return resultToHttp({ ok: false, reason: 'NOT_FOUND' });
    if (gate.status !== 'Incomplete') {
      return resultToHttp({ ok: false, reason: 'STATE_MISMATCH', currentStatus: gate.status });
    }
    if (body.settlementAmount > gate.rewardCredits) {
      return resultToHttp({ ok: false, reason: 'INVALID_FIELDS' });
    }
    if (gate.recentRejections >= MAX_REJECTIONS_PER_HOUR) {
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many rejected settlements for this errand. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return resultToHttp(
      await this.lifecycle.transition({
        errandId,
        expected: 'Incomplete',
        to: 'Settling-Credit',
        actor: admin(req.user.sub),
        set: { settlementAmount: body.settlementAmount, settlementNote: body.note },
      }),
    );
  }
}
