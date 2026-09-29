import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { RequestPasswordResetDto } from './DTO/request-password-reset.dto.js';
import { ConfirmPasswordResetDto } from './DTO/confirm-password-reset.dto.js';

describe('PasswordResetController', () => {
  let controller: PasswordResetController;
  const passwordResetService = {
    requestReset: vi.fn(),
    confirmReset: vi.fn(),
  };

  beforeEach(async () => {
    passwordResetService.requestReset.mockReset();
    passwordResetService.confirmReset.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PasswordResetController],
      providers: [
        { provide: PasswordResetService, useValue: passwordResetService },
      ],
    }).compile();

    controller = module.get<PasswordResetController>(PasswordResetController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('request', () => {
    it('passes the email to the service and returns a generic success message', async () => {
      const result = await controller.request({ email: 'eve@u.nus.edu' });

      expect(passwordResetService.requestReset).toHaveBeenCalledWith(
        'eve@u.nus.edu',
      );
      expect(result).toEqual({
        message: 'If this email is valid, a password reset link has been sent.',
      });
    });

    it('propagates service failures', async () => {
      passwordResetService.requestReset.mockRejectedValue(
        new Error('reset request failed'),
      );

      await expect(
        controller.request({ email: 'eve@u.nus.edu' }),
      ).rejects.toThrow('reset request failed');
    });
  });

  describe('confirm', () => {
    it('passes token and password to the service and returns a success message', async () => {
      const result = await controller.confirm({
        token: 'someToken123',
        password: 'NewStrongPassw0rd!',
      });

      expect(passwordResetService.confirmReset).toHaveBeenCalledWith(
        'someToken123',
        'NewStrongPassw0rd!',
      );
      expect(result).toEqual({ message: 'Password reset.' });
    });

    it('propagates the generic rejection from the service', async () => {
      passwordResetService.confirmReset.mockRejectedValue(
        new BadRequestException('Invalid or expired reset token.'),
      );

      await expect(
        controller.confirm({
          token: 'badToken',
          password: 'NewStrongPassw0rd!',
        }),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset token.'),
      );
    });
  });
});

describe('request body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  it('accepts an NUS email and normalizes it to lowercase', async () => {
    const value = await pipe.transform(
      { email: 'EVE@U.NUS.EDU' },
      bodyMetadata(RequestPasswordResetDto),
    );

    expect(value).toBeInstanceOf(RequestPasswordResetDto);
    expect(value).toMatchObject({ email: 'eve@u.nus.edu' });
  });

  it('accepts a token and a password meeting the F3.3 criteria', async () => {
    const value = await pipe.transform(
      { token: 'someToken123', password: 'NewStrongPassw0rd!' },
      bodyMetadata(ConfirmPasswordResetDto),
    );

    expect(value).toBeInstanceOf(ConfirmPasswordResetDto);
    expect(value).toMatchObject({
      token: 'someToken123',
      password: 'NewStrongPassw0rd!',
    });
  });

  it('rejects a password shorter than the F3.3 minimum of 12', async () => {
    await expect(
      pipe.transform(
        { token: 'someToken123', password: 'short' },
        bodyMetadata(ConfirmPasswordResetDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty token before the handler runs', async () => {
    await expect(
      pipe.transform(
        { token: '', password: 'NewStrongPassw0rd!' },
        bodyMetadata(ConfirmPasswordResetDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
