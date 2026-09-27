import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import {
  IsNusEmail,
  IsNusEmailConstraint,
} from './is-nus-email.validator.js';

describe('IsNusEmailConstraint', () => {
  const constraint = new IsNusEmailConstraint();

  describe('validate', () => {
    it.each([
      'eve@u.nus.edu',
      'eve@nus.edu.sg',
      'EVE@U.NUS.EDU',
      '"eve@x"@u.nus.edu',
    ])('accepts %s', (email) => {
      expect(constraint.validate(email)).toBe(true);
    });

    it.each([
      'eve@example.com',
      'eve@comp.nus.edu.sg',
      'eve@u.nus.edu.sg',
      // The NUS-looking suffix is in the local part; the real domain (after
      // the last '@') is evil.com, so this must not pass the pattern check.
      'u.nus.edu@evil.com',
      '@u.nus.edu',
      'eve@',
      'eve',
      '',
    ])('rejects %s', (email) => {
      expect(constraint.validate(email)).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(constraint.validate(42)).toBe(false);
    });
  });
});

describe('IsNusEmail as a class-validator rule', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  class TestDto {
    @IsEmail()
    @IsNusEmail()
    email: string;
  }
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  it('accepts an NUS email alongside the base email rule', async () => {
    const value = await pipe.transform(
      { email: 'eve@u.nus.edu' },
      bodyMetadata(TestDto),
    );

    expect(value).toMatchObject({ email: 'eve@u.nus.edu' });
  });

  it('rejects a non-NUS email', async () => {
    await expect(
      pipe.transform({ email: 'eve@example.com' }, bodyMetadata(TestDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed address with an NUS-looking tail', async () => {
    // The pattern check alone accepts the last-@ domain, but the base IsEmail
    // rule rejects the malformed double-@ address.
    await expect(
      pipe.transform({ email: 'eve@evil.com@u.nus.edu' }, bodyMetadata(TestDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
