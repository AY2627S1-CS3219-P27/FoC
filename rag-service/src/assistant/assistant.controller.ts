import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssistantService, type AssistantAnswer } from './assistant.service.js';
import { QuestionDto } from './question.dto.js';

@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** 200 even for "can't find it": the request worked, and that is an answer. */
  @Post('questions')
  @HttpCode(200)
  ask(
    @Body() body: QuestionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AssistantAnswer> {
    return this.assistant.ask(req.user.sub, body.question);
  }
}
