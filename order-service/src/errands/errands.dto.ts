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

  @IsOptional()
  @IsInt()
  @Min(MIN_EXPIRY_MINUTES)
  @Max(MAX_EXPIRY_MINUTES)
  expiryDurationMinutes?: number;
}
