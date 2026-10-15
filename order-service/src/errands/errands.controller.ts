import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { CreateErrandDto } from './errands.dto.js';
import { resultToHttp } from './result-to-http.js';

@Controller('v1/errands')
export class ErrandsController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
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
}
