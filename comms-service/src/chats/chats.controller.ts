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
  ArchiveDetailDto,
  ArchiveListResponseDto,
  ChatListResponseDto,
  CursorPageQueryDto,
  MessageHistoryQueryDto,
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

  @Get('archives')
  @ApiOperation({
    summary: 'List the authenticated participant’s archived chats',
  })
  @ApiOkResponse({ type: ArchiveListResponseDto })
  listArchives(
    @Req() request: AuthenticatedRequest,
    @Query() query: CursorPageQueryDto,
  ): Promise<ArchiveListResponseDto> {
    return this.chats.listArchives(request.user.sub, query.cursor, query.limit);
  }

  @Get('archives/:archiveId')
  @ApiOperation({
    summary: 'Read an immutable archived chat',
    description:
      'Unknown and unauthorized archive IDs share the same not-found response.',
  })
  @ApiOkResponse({ type: ArchiveDetailDto })
  @ApiNotFoundResponse({
    description: 'The archive is absent or the caller is not a participant.',
    type: ApiErrorResponseDto,
    example: { code: 'ARCHIVE_NOT_FOUND', message: 'Archive not found' },
  })
  archiveDetail(
    @Req() request: AuthenticatedRequest,
    @Param('archiveId', new ParseUUIDPipe({ version: '4' })) archiveId: string,
  ): Promise<ArchiveDetailDto> {
    return this.chats.archiveDetail(request.user.sub, archiveId);
  }

  @Get(':chatId/messages')
  @ApiOperation({
    summary: 'Read a live chat’s message history',
    description:
      'Forward paging is the backward-compatible default. Backward paging starts with the latest bounded page and continues toward older messages. Every page is returned in ascending sequence order. Unknown, archived, and unauthorized chat IDs share the same not-found response.',
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
    @Query() query: MessageHistoryQueryDto,
  ): Promise<MessageHistoryResponseDto> {
    return this.chats.history(
      request.user.sub,
      chatId,
      query.cursor,
      query.limit,
      query.direction,
    );
  }
}
