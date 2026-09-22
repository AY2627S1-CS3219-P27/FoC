import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OtpController } from './otp.controller.js';
import { OtpService } from './otp.service.js';
import { RequestOtpDto } from './DTO/RequestOtp.dto.js';

describe('OtpController', () => {
  let controller: OtpController;
  const otpService = { createOtpRequest: vi.fn() };

  beforeEach(async () => {
    otpService.createOtpRequest.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OtpController],
      providers: [{ provide: OtpService, useValue: otpService }],
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
});

describe('request body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = {
    type: 'body',
    metatype: RequestOtpDto,
  } as const;

  it('accepts a valid email', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com' },
      bodyMetadata,
    );

    expect(value).toBeInstanceOf(RequestOtpDto);
    expect(value).toMatchObject({ email: 'eve@example.com' });
  });

  it('rejects a malformed email before the handler runs', async () => {
    await expect(
      pipe.transform({ email: 'not-an-email' }, bodyMetadata),
    ).rejects.toThrow(BadRequestException);
  });
});
