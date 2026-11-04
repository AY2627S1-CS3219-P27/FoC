import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
  BEARER_SECURITY_SCHEME,
} from '../http/configure-http.js';
import { ChatQueryService } from './chat-query.service.js';
import {
  ApiErrorResponseDto,
  ChatListResponseDto,
  CursorPageQueryDto,
  MessageHistoryResponseDto,
} from './chats.dto.js';

@ApiTags('chats')
@ApiExtraModels(ApiErrorResponseDto)
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
@ApiUnauthorizedResponse({
  description: 'The access token is missing or invalid.',
  type: ApiErrorResponseDto,
  example: { code: 'INVALID_ACCESS_TOKEN', message: 'Invalid access token' },
})
@ApiBadRequestResponse({
  description: 'A parameter, limit, or opaque cursor is invalid.',
  type: ApiErrorResponseDto,
})
@Controller('v1/chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chats: ChatQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'List the authenticated participant’s live chats',
  })
  @ApiOkResponse({ type: ChatListResponseDto })
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: CursorPageQueryDto,
  ): Promise<ChatListResponseDto> {
    return this.chats.list(request.user.sub, query.cursor, query.limit);
  }

  @Get(':chatId/messages')
  @ApiOperation({
    summary: 'Read a live chat’s message history',
    description:
      'Unknown, archived, and unauthorized chat IDs share the same not-found response.',
  })
  @ApiOkResponse({ type: MessageHistoryResponseDto })
  @ApiNotFoundResponse({
    description: 'The live chat is absent or the caller is not a participant.',
    type: ApiErrorResponseDto,
    example: { code: 'CHAT_NOT_FOUND', message: 'Chat not found' },
  })
  history(
    @Req() request: AuthenticatedRequest,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query() query: CursorPageQueryDto,
  ): Promise<MessageHistoryResponseDto> {
    return this.chats.history(
      request.user.sub,
      chatId,
      query.cursor,
      query.limit,
    );
  }
}
