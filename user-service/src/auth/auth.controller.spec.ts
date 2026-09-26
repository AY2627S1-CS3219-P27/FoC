import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ConfigService } from '@nestjs/config';
import { RegisterDto } from './DTO/register.dto.js';
import { LoginDto } from './DTO/login.dto.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { registerWithToken: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = { registerWithToken: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        // AuthController reads NODE_ENV from ConfigService to set the cookie
        // `secure` flag; the login tests are covered separately.
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
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
    // Registration rejects are raised inside the service; the controller just
    // propagates them together with the response it received.
    authService.registerWithToken.mockRejectedValue(
      new UnauthorizedException('Invalid Registration Token'),
    );

    const request = {
      cookies: { registration_token: 'unknown-token' },
    };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await expect(
      controller.register(request as never, registerDto as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a non-string token', async () => {
    const request = {
      cookies: { registration_token: { dingus: 'bingus' } },
    };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await expect(
      controller.register(request as never, registerDto as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the provisioned user from the service', async () => {
    authService.registerWithToken.mockResolvedValue({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
    });

    const request = {
      cookies: { registration_token: 'issued-token' },
    };
    const registerDto = { displayName: 'Eve', password: 'StrongPassw0rd!' };

    await expect(
      controller.register(request as never, registerDto as never),
    ).resolves.toEqual({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
    });
  });
});

describe('AuthController login', () => {
  let controller: AuthController;
  let authService: { checkCredentials: ReturnType<typeof vi.fn> };
  let configGet: ReturnType<typeof vi.fn>;
  let res: { cookie: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authService = { checkCredentials: vi.fn() };
    configGet = vi.fn(() => 'development');
    res = { cookie: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  const loginDto = { email: 'eve@example.com', password: 'StrongPassw0rd!' };

  it('passes the credentials from the body to the service', async () => {
    authService.checkCredentials.mockResolvedValue({ accessToken: 'token' });

    await controller.login(loginDto as never, res as never);

    expect(authService.checkCredentials).toHaveBeenCalledWith(
      'eve@example.com',
      'StrongPassw0rd!',
    );
  });

  it('sets an httpOnly, same-site cookie with a millisecond maxAge', async () => {
    authService.checkCredentials.mockResolvedValue({ accessToken: 'jwt-token' });

    await controller.login(loginDto as never, res as never);

    // Literal values pin the wire contract: the JWT lives 15 minutes and the
    // cookie must expire in *milliseconds* (JWT_EXPIRATION_IN_SECONDS * 1000).
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'jwt-token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 900_000,
      secure: false,
    });
  });

  it('marks the cookie secure in production', async () => {
    authService.checkCredentials.mockResolvedValue({ accessToken: 'jwt-token' });
    configGet.mockReturnValue('production');

    await controller.login(loginDto as never, res as never);

    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'jwt-token',
      expect.objectContaining({ secure: true }),
    );
  });

  it('reports a successful login', async () => {
    authService.checkCredentials.mockResolvedValue({ accessToken: 'jwt-token' });

    await expect(
      controller.login(loginDto as never, res as never),
    ).resolves.toEqual({ message: 'Logged in.' });
  });

  it('sets no cookie when the credentials are rejected', async () => {
    authService.checkCredentials.mockRejectedValue(new UnauthorizedException());

    await expect(
      controller.login(loginDto as never, res as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('request body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  it('accepts a valid registration body', async () => {
    const value = await pipe.transform(
      { displayName: 'Eve', password: 'StrongPassw0rd!' },
      bodyMetadata(RegisterDto),
    );
    expect(value).toBeInstanceOf(RegisterDto);
    expect(value).toMatchObject({
      displayName: 'Eve',
      password: 'StrongPassw0rd!',
    });
  });

  it('accepts a one-character display name', async () => {
    const value = await pipe.transform(
      { displayName: 'a', password: 'StrongPassw0rd!' },
      bodyMetadata(RegisterDto),
    );
    expect(value).toBeInstanceOf(RegisterDto);
  });

  it('accepts a 255-character display name', async () => {
    const value = await pipe.transform(
      { displayName: 'a'.repeat(255), password: 'StrongPassw0rd!' },
      bodyMetadata(RegisterDto),
    );
    expect(value).toBeInstanceOf(RegisterDto);
  });

  it('rejects an empty display name before the handler runs', async () => {
    await expect(
      pipe.transform(
        { displayName: '', password: 'StrongPassw0rd!' },
        bodyMetadata(RegisterDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a display name over 255 characters before the handler runs', async () => {
    await expect(
      pipe.transform(
        { displayName: 'a'.repeat(256), password: 'StrongPassw0rd!' },
        bodyMetadata(RegisterDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a 12-character password', async () => {
    const value = await pipe.transform(
      { displayName: 'Eve', password: 'a'.repeat(12) },
      bodyMetadata(RegisterDto),
    );
    expect(value).toBeInstanceOf(RegisterDto);
  });

  it('accepts a 255-character password', async () => {
    const value = await pipe.transform(
      { displayName: 'Eve', password: 'a'.repeat(255) },
      bodyMetadata(RegisterDto),
    );
    expect(value).toBeInstanceOf(RegisterDto);
  });

  it('rejects a password shorter than 12 characters before the handler runs', async () => {
    await expect(
      pipe.transform(
        { displayName: 'Eve', password: 'a'.repeat(11) },
        bodyMetadata(RegisterDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a password longer than 255 characters before the handler runs', async () => {
    await expect(
      pipe.transform(
        { displayName: 'Eve', password: 'a'.repeat(256) },
        bodyMetadata(RegisterDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('login body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  it('accepts a valid login body', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com', password: 'StrongPassw0rd!' },
      bodyMetadata(LoginDto),
    );
    expect(value).toBeInstanceOf(LoginDto);
    expect(value).toMatchObject({
      email: 'eve@example.com',
      password: 'StrongPassw0rd!',
    });
  });

  it('rejects a non-email address before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'not-an-email', password: 'StrongPassw0rd!' },
        bodyMetadata(LoginDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing email before the handler runs', async () => {
    await expect(
      pipe.transform({ password: 'StrongPassw0rd!' }, bodyMetadata(LoginDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-string password before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'eve@example.com', password: 12345678 },
        bodyMetadata(LoginDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a 12-character password', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com', password: 'a'.repeat(12) },
      bodyMetadata(LoginDto),
    );
    expect(value).toBeInstanceOf(LoginDto);
  });

  it('accepts a 255-character password', async () => {
    const value = await pipe.transform(
      { email: 'eve@example.com', password: 'a'.repeat(255) },
      bodyMetadata(LoginDto),
    );
    expect(value).toBeInstanceOf(LoginDto);
  });

  it('rejects a password shorter than 12 characters before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'eve@example.com', password: 'a'.repeat(11) },
        bodyMetadata(LoginDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a password longer than 255 characters before the handler runs', async () => {
    await expect(
      pipe.transform(
        { email: 'eve@example.com', password: 'a'.repeat(256) },
        bodyMetadata(LoginDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
