import { Role } from '@foc/contracts';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { API_STATUSES, type ApiStatus } from './api-status.js';
import { MAX_EXPIRY_MINUTES, MIN_EXPIRY_MINUTES } from '../lifecycle/create.js';

const MAX_LOCATION_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const NOT_BLANK = /\S/;
// reward_credits is a Postgres integer; a bigger amount would fail the write.
const MAX_CREDITS = 2_147_483_647;

// The body of POST /v1/errands. 

export class CreateErrandDto {
  @IsUUID()
  supplierId: string;

  @IsString()
  @Length(1, MAX_LOCATION_LENGTH)
  @Matches(NOT_BLANK)
  deliveryLocation: string;

  @IsInt()
  @Min(1)
  @Max(MAX_CREDITS)
  rewardCredits: number;

  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_LENGTH)
  @Matches(NOT_BLANK)
  pickupLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @IsInt()
  @Min(MIN_EXPIRY_MINUTES)
  @Max(MAX_EXPIRY_MINUTES)
  expiryDurationMinutes: number;

  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  @Matches(NOT_BLANK)
  collectionItems: string;
}

// F7.4: the courier must say why. Same limits as the CourierWithdrew payload.
export class WithdrawErrandDto {
  @IsString()
  @MaxLength(500)
  @Matches(NOT_BLANK)
  reason: string;
}

export class AdjustErrandDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CREDITS)
  newAmount: number;
}

export const LIST_SORTS = ['expiring', 'newest', 'credits'] as const;
export type ListSort = (typeof LIST_SORTS)[number];
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_OFFSET = 2_147_483_647;

// Paging shared by the read routes. Numbers arrive as strings, hence @Type.
export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_OFFSET)
  offset: number = 0;
}

// Query string of GET /v1/errands.
export class ListErrandsQuery extends PageQuery {
  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_LENGTH)
  pickupBuilding?: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_LENGTH)
  deliveryBuilding?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CREDITS)
  minCredits?: number;

  @IsOptional()
  @IsIn(LIST_SORTS)
  sort: ListSort = 'expiring';
}

// Query string of GET /v1/errands/mine. `status` takes API names only;
// `role` keeps only the errands where the caller is on that side.
export class MineErrandsQuery extends PageQuery {
  @IsOptional()
  @IsIn(API_STATUSES)
  status?: ApiStatus;

  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;
}
