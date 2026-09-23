import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { registerWithToken: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = { registerWithToken: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the registration token from the cookie to the service', async () => {
    const request = {
      cookies: { registration_token: 'issued-token' },
    };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await controller.register(request as never, registerDto as never);

    expect(authService.registerWithToken).toHaveBeenCalledWith(
      'issued-token',
      'Eve',
      'StrongPassw0rd!',
    );
  });

  it('rejects a missing registration token cookie', async () => {
    const request = { cookies: {} };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await expect(
      controller.register(request as never, registerDto as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.registerWithToken).not.toHaveBeenCalled();
  });

  it('rejects a token with no matching record', async () => {
    authService.registerWithToken.mockResolvedValue(null);

    const request = {
      cookies: { registration_token: 'unknown-token' },
    };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await expect(
      controller.register(request as never, registerDto as never),
    ).rejects.toThrow(UnauthorizedException);
  });
});