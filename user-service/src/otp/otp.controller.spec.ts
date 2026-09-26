import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpController } from './otp.controller.js';
import { OtpService } from './otp.service.js';
import { RequestOtpDto } from './DTO/request-otp.dto.js';
import { ValidateOtpDto } from './DTO/validate-otp.dto.js';

describe('OtpController', () => {
  let controller: OtpController;
  const otpService = {
    createOtpRequest: vi.fn(),
    validateOtpAndIssueToken: vi.fn(),
  };
  const res = { cookie: vi.fn() };
  const configService = { get: vi.fn() };

  beforeEach(async () => {
    otpService.createOtpRequest.mockReset();
    otpService.validateOtpAndIssueToken.mockReset();
    res.cookie.mockReset();
    configService.get.mockReset();
    configService.get.mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [
        { provide: OtpService, useValue: otpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<OtpController>(OtpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the email to the service and returns a generic success message', async () => {
    const result = await controller.request({ email: 'eve@example.com' });

    expect(otpService.createOtpRequest).toHaveBeenCalledWith('eve@example.com');
    expect(result).toEqual({
      message: 'If this email is valid, an OTP has been sent.',
    });
  });

  it('propagates service failures', async () => {
    otpService.createOtpRequest.mockRejectedValue(new Error('otp failed'));

    await expect(
      controller.request({ email: 'eve@example.com' }),
    ).rejects.toThrow('otp failed');
  });

  describe('validate', () => {
    it('passes email and otp to the service and returns a success message', async () => {
      otpService.validateOtpAndIssueToken.mockResolvedValue({
        token: 'tok123',
        validForSeconds: 600,
      });

      const result = await controller.validate(
        { email: 'eve@example.com', otp: 'Ab3_-x9' },
        res,
      );

      expect(otpService.validateOtpAndIssueToken).toHaveBeenCalledWith(
        'eve@example.com',
        'Ab3_-x9',
      );
      expect(result).toEqual({ message: 'OTP validated.' });
    });

    it('sets the registration token cookie bound to the verified email with a 10-minute Max-Age', async () => {
      otpService.validateOtpAndIssueToken.mockResolvedValue({
        token: 'tok123',
        validForSeconds: 600,
      });

      await controller.validate(
        { email: 'eve@example.com', otp: 'Ab3_-x9' },
        res,
      );

      expect(res.cookie).toHaveBeenCalledTimes(1);
      expect(res.cookie).toHaveBeenCalledWith('registration_token', 'tok123', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // 600 s validity * 1000 => Max-Age=600, matching the service's TTL.
        maxAge: 600000,
        secure: false,
      });
    });

    it('rejects with the same fixed error for every F1.4 failure and sets no cookie', async () => {
      // Unknown, expired, revoked and consumed OTPs all surface identically:
      // the controller must not reveal which condition failed.
      otpService.validateOtpAndIssueToken.mockResolvedValue(null);

      await expect(
        controller.validate({ email: 'eve@example.com', otp: 'Ab3_-x9' }, res),
      ).rejects.toThrow(new BadRequestException('Invalid OTP.'));

      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('propagates service failures', async () => {
      otpService.validateOtpAndIssueToken.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(
        controller.validate({ email: 'eve@example.com', otp: 'Ab3_-x9' }, res),
      ).rejects.toThrow('redis down');
    });
  });
});

describe('request body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  it('accepts a valid email', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com' },
      bodyMetadata(RequestOtpDto),
    );

    expect(value).toBeInstanceOf(RequestOtpDto);
    expect(value).toMatchObject({ email: 'eve@example.com' });
  });

  it('rejects a malformed email before the handler runs', async () => {
    await expect(
      pipe.transform({ email: 'not-an-email' }, bodyMetadata(RequestOtpDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid email and six-character otp', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com', otp: 'abc123' },
      bodyMetadata(ValidateOtpDto),
    );

    expect(value).toBeInstanceOf(ValidateOtpDto);
    expect(value).toMatchObject({ email: 'eve@example.com', otp: 'abc123' });
  });

  it('rejects a malformed email before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'not-an-email', otp: 'abc123' },
        bodyMetadata(ValidateOtpDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-six-character otp before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'eve@example.com', otp: 'short' },
        bodyMetadata(ValidateOtpDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
