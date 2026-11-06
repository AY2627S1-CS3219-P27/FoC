import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { createValidationPipe } from './validation.pipe.js';

class PointDto {
  @IsInt()
  @Min(-90)
  @Max(90)
  latitude: number;
}

class SampleDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @ValidateNested()
  @Type(() => PointDto)
  coordinates: PointDto;
}

async function rejectionOf(value: unknown) {
  const pipe = createValidationPipe();
  try {
    await pipe.transform(value, { type: 'body', metatype: SampleDto });
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('expected the pipe to reject the value');
}

describe('createValidationPipe', () => {
  it('passes a compliant body through, transformed to the DTO class', async () => {
    const pipe = createValidationPipe();

    const result: unknown = await pipe.transform(
      { name: 'Cool Spot', coordinates: { latitude: 1 } },
      { type: 'body', metatype: SampleDto },
    );

    expect(result).toBeInstanceOf(SampleDto);
  });

  it('lists every non-compliant field, including nested ones', async () => {
    const body = await rejectionOf({
      name: '',
      coordinates: { latitude: 200 },
    });

    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      violations: [
        { field: 'name', reason: expect.stringContaining('name') },
        {
          field: 'coordinates.latitude',
          reason: expect.stringContaining('latitude'),
        },
      ],
    });
  });

  it('rejects unknown and system-managed fields instead of stripping them', async () => {
    const body = await rejectionOf({
      name: 'Cool Spot',
      coordinates: { latitude: 1 },
      version: 3,
    });

    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      violations: [
        { field: 'version', reason: 'property version should not exist' },
      ],
    });
  });
});
