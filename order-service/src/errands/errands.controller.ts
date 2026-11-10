import { type AuthenticatedRequest, JwtAuthGuard, Roles, RolesGuard } from '@foc/auth';
import { Role } from '@foc/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CAMPUS_CONTAINS } from '../campus/campus.module.js';
import type { CampusContains } from '../campus/campus-boundary.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import {
  WithdrawErrandDto,
  AdjustErrandDto,
  CreateErrandDto,
  EditErrandDto,
  ListErrandsQuery,
  MineErrandsQuery,
} from './errands.dto.js';
import { ErrandsQueryService } from './errands.query.js';
import { requesterCanCancel } from '../lifecycle/edges.js';
import { toApiStatus } from './api-status.js';
import { user, type TransitionInput } from '../lifecycle/transition.js';
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
    @Inject(CAMPUS_CONTAINS) private readonly campusContains: CampusContains,
  ) {}

  // Reads go to the query service, never through transition().
  @Get()
  @Roles(Role.Courier)
  list(@Query() query: ListErrandsQuery, @Req() req: AuthenticatedRequest) {
    return this.queries.list(req.user.sub, query);
  }

  // Declared before :id so 'mine' is not parsed as an id.
  @Get('mine')
  @Roles(Role.Requester, Role.Courier)
  mine(@Query() query: MineErrandsQuery, @Req() req: AuthenticatedRequest) {
    return this.queries.mine(req.user.sub, query);
  }

  @Get(':id')
  @Roles(Role.Requester, Role.Courier)
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    const view = await this.queries.detail(req.user.sub, id);
    if (!view) throw new NotFoundException('Errand not found.');
    return view;
  }

  @Post()
  @Roles(Role.Requester)
  async create(
    @Body() body: CreateErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pin = body.deliveryPin;
    if (pin && !this.campusContains(pin.latitude, pin.longitude)) {
      throw new BadRequestException('The delivery pin is outside the campus.');
    }
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

  // F2: one transition per edit, carrying the local changes with it. A new supplier
  // or building is re-checked by supplier-service (Revalidating-Supplier), a new
  // reward goes through credit (Adjusting-Credit), anything else changes in place.
  // Routing looks only at the body, so a retried request takes the same edge.
  @Patch(':id')
  @Roles(Role.Requester)
  @HttpCode(200)
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EditErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rewardCredits, expiryDurationMinutes, supplierId, deliveryBuildingId, ...fields } = body;
    // Absent fields must not reach transition() as explicit undefineds.
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const expiry = expiryDurationMinutes === undefined ? {} : { expiryDurationMinutes };
    let edge: Pick<TransitionInput, 'to' | 'payload' | 'set'>;
    if (supplierId !== undefined || deliveryBuildingId !== undefined) {
      // The half not being changed is re-checked as it stands.
      const current = await this.lifecycle.replyErrandOf(id);
      if (!current) return resultToHttp({ ok: false, reason: 'NOT_FOUND' });
      // A new building drops the venue, and without a venue the note is required (F2.1.1).
      if (
        deliveryBuildingId !== undefined &&
        deliveryBuildingId.toLowerCase() !== current.deliveryBuildingId.toLowerCase() &&
        fields.deliveryDetail === undefined &&
        !current.deliveryDetail.trim()
      ) {
        return resultToHttp({ ok: false, reason: 'INVALID_FIELDS' });
      }
      // With a new reward too, supplier-service answers first, then credit (Editing).
      edge = {
        to: rewardCredits === undefined ? 'Revalidating-Supplier' : 'Editing',
        payload: rewardCredits === undefined ? expiry : { ...expiry, newAmount: rewardCredits },
        set: {
          ...set,
          pendingSupplierId: supplierId ?? current.supplierId,
          pendingDeliveryBuildingId: deliveryBuildingId ?? current.deliveryBuildingId,
        },
      };
    } else if (rewardCredits !== undefined) {
      edge = { to: 'Adjusting-Credit', payload: { ...expiry, newAmount: rewardCredits }, set };
    } else {
      edge = { to: 'Open', payload: expiry, set };
    }
    const result = await this.lifecycle.transition({
      errandId: id,
      expected: 'Open',
      ...edge,
      actor: user(req.user.sub),
      idempotencyKey,
    });
    // F2.1.2: past Open. An edit already in flight (Updating) stays a plain retry.
    if (
      !result.ok &&
      result.reason === 'STATE_MISMATCH' &&
      !['Open', 'Updating'].includes(toApiStatus(result.currentStatus))
    ) {
      return resultToHttp({ ok: false, reason: 'NOT_EDITABLE' });
    }
    return this.answer(result, res);
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
