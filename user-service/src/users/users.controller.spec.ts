import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { ConfigService } from '@nestjs/config';
import { UpdateRolesDto } from './DTO/update-roles.dto.js';
import { ACCESS_TOKEN_COOKIE, Role } from '@foc/contracts';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getUserById: ReturnType<typeof vi.fn>;
    updateRoles: ReturnType<typeof vi.fn>;
  };
  let configGet: ReturnType<typeof vi.fn>;
  let res: { clearCookie: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    usersService = {
      getUserById: vi.fn(),
      updateRoles: vi.fn(),
    };
    configGet = vi.fn(() => 'development');
    res = { clearCookie: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  const authenticatedRequest = {
    user: {
      sub: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [] as Role[],
    },
  };

  describe('getMe', () => {
    it('returns the authenticated user from the database', async () => {
      usersService.getUserById.mockResolvedValue({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester],
        isAdmin: false,
      });

      await expect(
        controller.getMe(authenticatedRequest as never),
      ).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester],
        isAdmin: false,
      });
      expect(usersService.getUserById).toHaveBeenCalledWith(7);
    });

    it('rejects when the account no longer exists', async () => {
      usersService.getUserById.mockResolvedValue(null);

      await expect(
        controller.getMe(authenticatedRequest as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateMeRoles', () => {
    it('persists the new roles for the authenticated user', async () => {
      usersService.updateRoles.mockResolvedValue({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester, Role.Courier],
        isAdmin: false,
      });

      await expect(
        controller.updateMeRoles(
          authenticatedRequest as never,
          { roles: [Role.Requester, Role.Courier] } as never,
          res as never,
        ),
      ).resolves.toEqual({ roles: [Role.Requester, Role.Courier] });

      expect(usersService.updateRoles).toHaveBeenCalledWith(7, [
        Role.Requester,
        Role.Courier,
      ]);
    });

    it('clears the access token cookie in development', async () => {
      usersService.updateRoles.mockResolvedValue({ roles: [] });

      await controller.updateMeRoles(
        authenticatedRequest as never,
        { roles: [] } as never,
        res as never,
      );

      // Literal options pin the wire contract: the clear must mirror the
      // cookie's path and flags so the browser actually drops it.
      expect(res.clearCookie).toHaveBeenCalledWith('access_token', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
      });
    });

    it('clears the cookie as secure in production', async () => {
      configGet.mockReturnValue('production');
      usersService.updateRoles.mockResolvedValue({ roles: [] });

      await controller.updateMeRoles(
        authenticatedRequest as never,
        { roles: [] } as never,
        res as never,
      );

      expect(res.clearCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        expect.objectContaining({ secure: true }),
      );
    });

    it('reports the new roles after the change', async () => {
      usersService.updateRoles.mockResolvedValue({
        roles: [Role.Requester],
      });

      await expect(
        controller.updateMeRoles(
          authenticatedRequest as never,
          { roles: [Role.Requester] } as never,
          res as never,
        ),
      ).resolves.toEqual({ roles: [Role.Requester] });
    });
  });
});

describe('update roles body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const bodyMetadata = (metatype: Function) =>
    ({ type: 'body', metatype }) as const;

  const validRoles = {
    roles: [Role.Requester, Role.Courier],
  };

  it('accepts a valid roles body', async () => {
    const value = await pipe.transform(
      validRoles,
      bodyMetadata(UpdateRolesDto),
    );
    expect(value).toBeInstanceOf(UpdateRolesDto);
    expect(value).toMatchObject(validRoles);
  });

  it('accepts opting out of every role', async () => {
    const value = await pipe.transform(
      { roles: [] },
      bodyMetadata(UpdateRolesDto),
    );
    expect(value).toBeInstanceOf(UpdateRolesDto);
    expect(value).toMatchObject({ roles: [] });
  });

  it('tolerates duplicates, which the service normalises away', async () => {
    const value = await pipe.transform(
      { roles: [Role.Requester, Role.Requester] },
      bodyMetadata(UpdateRolesDto),
    );
    expect(value).toBeInstanceOf(UpdateRolesDto);
  });

  it('rejects a non-array roles body', async () => {
    await expect(
      pipe.transform({ roles: 'requester' }, bodyMetadata(UpdateRolesDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a role that is not a participant role', async () => {
    await expect(
      pipe.transform({ roles: ['admin'] }, bodyMetadata(UpdateRolesDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing roles field', async () => {
    await expect(
      pipe.transform({}, bodyMetadata(UpdateRolesDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
