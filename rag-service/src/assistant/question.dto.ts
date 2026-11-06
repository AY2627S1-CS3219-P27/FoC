import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const MAX_QUESTION_LENGTH = 500;

export class QuestionDto {
  @Transform(trim)
  @IsString()
  @Length(1, MAX_QUESTION_LENGTH, {
    message: `question must be 1-${MAX_QUESTION_LENGTH} characters after trimming`,
  })
  question: string;
}
