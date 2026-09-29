import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RequestType } from '../../database/entities/index.js';
import { MAX_PAGE_SIZE } from '../../suppliers/dto/list-suppliers-query.dto.js';

/** The admin queue of Pending requests (F6.7), paginated per N3.1. */
export class ListRequestsQueryDto {
  /** Only requests of this type. */
  @IsOptional()
  @IsEnum(RequestType, {
    message: `type must be one of ${Object.values(RequestType).join(', ')}`,
  })
  type?: RequestType;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be a whole number' })
  @Min(0)
  offset: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 25;
}
