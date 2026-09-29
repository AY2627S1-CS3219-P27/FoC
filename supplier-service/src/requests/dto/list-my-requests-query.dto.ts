import { IsEnum, IsOptional } from 'class-validator';
import { RequestState } from '../../database/entities/index.js';
import { ListRequestsQueryDto } from './list-requests-query.dto.js';

/** The caller's own requests (F6.5): also filterable by state. */
export class ListMyRequestsQueryDto extends ListRequestsQueryDto {
  /** Only requests in this state. */
  @IsOptional()
  @IsEnum(RequestState, {
    message: `state must be one of ${Object.values(RequestState).join(', ')}`,
  })
  state?: RequestState;
}
