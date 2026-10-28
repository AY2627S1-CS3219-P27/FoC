import { IsString, Matches, MaxLength } from 'class-validator';

export const MAX_REPORT_LENGTH = 2000;

// The body of POST /v1/errands/:id/report. Text only.
export class ReportDto {
  @IsString()
  @MaxLength(MAX_REPORT_LENGTH)
  @Matches(/\S/)
  body: string;
}
