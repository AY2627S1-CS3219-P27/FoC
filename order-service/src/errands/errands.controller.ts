import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { WithdrawErrandDto, AdjustErrandDto, CreateErrandDto } from './errands.dto.js';
import { requesterCanCancel } from '../lifecycle/edges.js';
import { user } from '../lifecycle/transition.js';
import { ACTIONS, type ActionContext, type ActionName } from './actions.js';
import { IdempotencyKey } from './idempotency-key.js';
import { resultToHttp } from './result-to-http.js';

// Every route needs a valid access token: none of them is public.
@Controller('v1/errands')
@UseGuards(JwtAuthGuard)
export class ErrandsController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Post()
  async create(
    @Body() body: CreateErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    const result = await this.lifecycle.create({
      ...body,
      requesterId: req.user.sub,
      idempotencyKey,
    });
    return resultToHttp(result);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('accept', id, req.user.sub, idempotencyKey);
  }

  @Post(':id/pickup')
  @HttpCode(200)
  pickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('pickup', id, req.user.sub, idempotencyKey);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('deliver', id, req.user.sub, idempotencyKey);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('confirm', id, req.user.sub, idempotencyKey);
  }

  @Post(':id/incomplete')
  @HttpCode(200)
  incomplete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('incomplete', id, req.user.sub, idempotencyKey);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('withdraw', id, req.user.sub, idempotencyKey, body);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustErrandDto,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.run('adjust', id, req.user.sub, idempotencyKey, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string | undefined,
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
    return resultToHttp(result);
  }

  // looks up the action's row and runs it as one transition
  private async run(
    action: ActionName,
    errandId: string,
    callerId: string,
    idempotencyKey: string | undefined,
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
    
    return resultToHttp(result);
  }
}
