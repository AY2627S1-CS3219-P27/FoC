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
import { user } from '../lifecycle/transition.js';
import { ACTIONS, type ActionContext, type ActionName } from './actions.js';
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
  ) {
    const result = await this.lifecycle.create({
      ...body,
      requesterId: req.user.sub,
    });
    return resultToHttp(result);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('accept', id, req.user.sub);
  }

  @Post(':id/pickup')
  @HttpCode(200)
  pickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('pickup', id, req.user.sub);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('deliver', id, req.user.sub);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('confirm', id, req.user.sub);
  }

  @Post(':id/incomplete')
  @HttpCode(200)
  incomplete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('incomplete', id, req.user.sub);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WithdrawErrandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.run('withdraw', id, req.user.sub, body);
  }

  @Post(':id/adjust')
  @HttpCode(200)
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdjustErrandDto,
    @Req() req: AuthenticatedRequest) {
    return this.run('adjust', id, req.user.sub, body);
  }

  // looks up the action's row and runs it as one transition
  private async run(
    action: ActionName,
    errandId: string,
    callerId: string,
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
    });
    
    return resultToHttp(result);
  }
}
