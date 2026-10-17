import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiBody,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { type AuthenticatedRequest, JwtAuthGuard } from '@foc/auth';
import {
  ACCESS_TOKEN_COOKIE_SECURITY_SCHEME,
  BEARER_SECURITY_SCHEME,
} from '../http/configure-http.js';
import { CreditAccountQueryService } from './credit-account-query.service.js';
import {
  ApiErrorResponseDto,
  CreditBalanceResponseDto,
  CreditSufficiencyRequestDto,
  CreditSufficiencyResponseDto,
} from './credits.dto.js';

type ResponseModel =
  typeof CreditBalanceResponseDto | typeof CreditSufficiencyResponseDto;

const EXAMPLE_USER_ID = '11111111-1111-4111-8111-111111111111';

function successResponse(
  model: ResponseModel,
  description: string,
  example: Record<string, unknown>,
) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(model) },
        example,
      },
    },
  };
}

function errorResponse(description: string, example: Record<string, unknown>) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        example,
      },
    },
  };
}

@ApiTags('credits')
@ApiExtraModels(
  ApiErrorResponseDto,
  CreditBalanceResponseDto,
  CreditSufficiencyResponseDto,
)
@ApiProduces('application/json')
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiSecurity(ACCESS_TOKEN_COOKIE_SECURITY_SCHEME)
@ApiUnauthorizedResponse(
  errorResponse('The access token is missing or invalid.', {
    code: 'INVALID_ACCESS_TOKEN',
    message: 'Invalid access token',
  }),
)
@Controller('v1/credits')
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(private readonly accounts: CreditAccountQueryService) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Get the authenticated user credit balance',
    description:
      'Returns available and reserved credit without locking or changing the account.',
  })
  @ApiOkResponse(
    successResponse(
      CreditBalanceResponseDto,
      'The current balance for the authenticated user.',
      { userId: EXAMPLE_USER_ID, creditBalance: 100, reservedBalance: 0 },
    ),
  )
  @ApiNotFoundResponse(
    errorResponse('The authenticated user has no Credit account.', {
      code: 'CREDIT_ACCOUNT_NOT_FOUND',
      message: 'Credit account not found',
    }),
  )
  getBalance(
    @Req() request: AuthenticatedRequest,
  ): Promise<CreditBalanceResponseDto> {
    return this.accounts.getBalance(request.user.sub);
  }

  @Post('sufficiency')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check available credit without reserving it',
    description:
      'Returns point-in-time advice only. It does not lock the account, reserve credit, or authorize a later reservation.',
  })
  @ApiBody({
    type: CreditSufficiencyRequestDto,
    examples: {
      sufficient: {
        summary: 'Available credit covers the amount',
        value: { userId: EXAMPLE_USER_ID, amount: 50 },
      },
      insufficient: {
        summary: 'Requested amount exceeds available credit',
        value: { userId: EXAMPLE_USER_ID, amount: 150 },
      },
    },
  })
  @ApiOkResponse(
    successResponse(
      CreditSufficiencyResponseDto,
      'Point-in-time sufficiency advice for the authenticated user.',
      { userId: EXAMPLE_USER_ID, amount: 50, sufficient: true },
    ),
  )
  @ApiBadRequestResponse(
    errorResponse('The request body violates the API contract.', {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      reasons: [{ field: 'amount', reason: 'amount must not be less than 1' }],
    }),
  )
  @ApiForbiddenResponse(
    errorResponse('The requested user differs from the authenticated user.', {
      code: 'SUBJECT_MISMATCH',
      message: 'Requested user does not match authenticated user',
    }),
  )
  @ApiNotFoundResponse(
    errorResponse('The authenticated user has no Credit account.', {
      code: 'CREDIT_ACCOUNT_NOT_FOUND',
      message: 'Credit account not found',
    }),
  )
  async checkSufficiency(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreditSufficiencyRequestDto,
  ): Promise<CreditSufficiencyResponseDto> {
    if (body.userId !== request.user.sub) {
      throw new ForbiddenException({
        code: 'SUBJECT_MISMATCH',
        message: 'Requested user does not match authenticated user',
      });
    }

    const balance = await this.accounts.getBalance(request.user.sub);
    return {
      userId: request.user.sub,
      amount: body.amount,
      sufficient: balance.creditBalance >= body.amount,
    };
  }
}
