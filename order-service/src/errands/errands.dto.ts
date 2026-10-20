import {
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