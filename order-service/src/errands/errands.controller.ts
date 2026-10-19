import { type AuthenticatedRequest, JwtAuthGuard, Roles, RolesGuard } from '@foc/auth';
import { Role } from '@foc/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import {
  WithdrawErrandDto,
  AdjustErrandDto,
  CreateErrandDto,
  ListErrandsQuery,
} from './errands.dto.js';
import { ErrandsQueryService } from './errands.query.js';
import { requesterCanCancel } from '../lifecycle/edges.js';
import { user } from '../lifecycle/transition.js';
import { ACTIONS, type ActionContext, type ActionName } from './actions.js';
import { IdempotencyKey } from './idempotency-key.js';
import { isReplay, REPLAYED_HEADER, resultToHttp } from './result-to-http.js';

// Every route needs a valid access token (none is public) and the participant
// role that takes its edge. The role is a first gate only: transition() still
// checks the caller is this errand's requester or courier.
@Controller('v1/errands')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ErrandsController {
  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly queries: ErrandsQueryService,
  ) {}

  // Reads go to the query service, never through transition().
  @Get()
  @Roles(Role.Courier)
  list(@Query() query: ListErrandsQuery, @Req() req: AuthenticatedRequest) {
    return this.queries.list(req.user.sub, query);
  }

  @Post()
  @Roles(Role.Requester)
  async create(
    @Body() body: CreateErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.lifecycle.create({
      ...body,
      requesterId: req.user.sub,
      idempotencyKey,
    });
    // 201 means "created now"; a replay created nothing.
    if (isReplay(result)) res.status(200);
    return this.answer(result, res);
  }

  @Post(':id/accept')
  @Roles(Role.Courier)
  @HttpCode(200)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('accept', id, req.user.sub, idempotencyKey, res);
  }

  @Post(':id/pickup')
  @Roles(Role.Courier)
  @HttpCode(200)
  pickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('pickup', id, req.user.sub, idempotencyKey, res);
  }

  @Post(':id/deliver')
  @Roles(Role.Courier)
  @HttpCode(200)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('deliver', id, req.user.sub, idempotencyKey, res);
  }

  @Post(':id/confirm')
  @Roles(Role.Requester)
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('confirm', id, req.user.sub, idempotencyKey, res);
  }

  @Post(':id/incomplete')
  @Roles(Role.Requester)
  @HttpCode(200)
  incomplete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('incomplete', id, req.user.sub, idempotencyKey, res);
  }

  @Post(':id/withdraw')
  @Roles(Role.Courier)
  @HttpCode(200)
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('withdraw', id, req.user.sub, idempotencyKey, res, body);
  }

  @Post(':id/adjust')
  @Roles(Role.Requester)
  @HttpCode(200)
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.run('adjust', id, req.user.sub, idempotencyKey, res, body);
  }

  @Post(':id/cancel')
  @Roles(Role.Requester)
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const status = await this.lifecycle.currentStatus(id);
    if (status === undefined) {
      return resultToHttp({ ok: false, reason: 'NOT_FOUND' });
    }

    //idempotency check for cancelled
    const expected =
      status === 'Cancelled'
        ? ((await this.lifecycle.lastEvent(id))?.fromStatus ?? status)
        : status;

    if (!requesterCanCancel(expected)) {
      return resultToHttp({ ok: false, reason: 'NOT_CANCELLABLE' });
    }

    const result = await this.lifecycle.transition({
      errandId: id,
      expected,
      to: 'Cancelled',
      actor: user(req.user.sub),
      set: { cancellationReason: 'REQUESTER_CANCELLED' },
      idempotencyKey,
    });
    return this.answer(result, res);
  }

  // looks up the action's row and runs it as one transition
  private async run(
    action: ActionName,
    errandId: string,
    callerId: string,
    idempotencyKey: string | undefined,
    res: Response,
    body?: ActionContext['body'],
  ) {
    const actionValue = ACTIONS[action];

    const actionReturn = actionValue['build']({ callerId, body });

    const result = await this.lifecycle.transition({
      errandId,
      expected: actionValue.expected,
      to: actionValue.to,
      actor: user(callerId),
      ...actionReturn,
      idempotencyKey,
    });

    // Losing a concurrent accept: someone else moved the errand off Open first.
    if (action === 'accept' && !result.ok && result.reason === 'STATE_MISMATCH') {
      return resultToHttp({ ok: false, reason: 'ERRAND_UNAVAILABLE' });
    }
    return this.answer(result, res);
  }

  // Marks a replay for the client, then maps the result to the body or an error.
  private answer(result: Parameters<typeof resultToHttp>[0], res: Response) {
    if (isReplay(result)) res.setHeader(REPLAYED_HEADER, 'true');
    return resultToHttp(result);
  }
}
