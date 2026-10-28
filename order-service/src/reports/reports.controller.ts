import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReportDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

const CONFLICT = {
  NOT_INCOMPLETE: 'Reports can only be filed on an Incomplete errand.',
  SETTLEMENT_REQUESTED: 'Settlement has started, so reports are closed.',
  ALREADY_REPORTED: 'You have already filed a report on this errand.',
};

// Party check is in the service (requester or courier of this errand), so no RolesGuard.
@Controller('v1/errands')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(':id/report')
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const res = await this.reports.file(id, req.user.sub, body.body);
    if (res.ok) return { filed: true };
    if (res.reason === 'NOT_FOUND') throw new NotFoundException('Errand not found.');
    throw new ConflictException({ code: res.reason, message: CONFLICT[res.reason] });
  }
}
