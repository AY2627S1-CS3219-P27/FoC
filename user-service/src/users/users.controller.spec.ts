import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '@foc/auth';
import { UpdateRolesDto } from './DTO/update-roles.dto.js';
import { ListUsersQueryDto } from './DTO/list-users.query.dto.js';
import { ACCESS_TOKEN_COOKIE, Role } from '@foc/contracts';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getUserByUuid: ReturnType<typeof vi.fn>;
    updateRoles: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
  };
  let configGet: ReturnType<typeof vi.fn>;
  let res: { clearCookie: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    usersService = {
      getUserByUuid: vi.fn(),
      updateRoles: vi.fn(),
      listUsers: vi.fn(),
    };
    configGet = vi.fn(() => 'development');
    res = { clearCookie: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    })
      // JwtAuthGuard's token verification is exercised at the e2e level; here
      // the module-level guard is a passthrough so the controller's own
      // behaviour under an authenticated request can be asserted directly.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  const authenticatedRequest = {
    user: {
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [] as Role[],
    },
  };

  describe('getMe', () => {
    it('returns the authenticated user from the database', async () => {
      usersService.getUserByUuid.mockResolvedValue({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester],
        isAdmin: false,
      });

      await expect(
        controller.getMe(authenticatedRequest as never),
      ).resolves.toEqual({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester],
        isAdmin: false,
      });
      expect(usersService.getUserByUuid).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('rejects when the account no longer exists', async () => {
      usersService.getUserByUuid.mockResolvedValue(null);

      await expect(
        controller.getMe(authenticatedRequest as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateMeRoles', () => {
    it('persists the new roles for the authenticated user', async () => {
      usersService.updateRoles.mockResolvedValue({
        uuid: '11111111-1111-4111-8111-111111111111',
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

      expect(usersService.updateRoles).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        [Role.Requester, Role.Courier],
      );
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

  describe('listUsers', () => {
    // A stored row as the repository would hand it to the projectors.
    const storedUser = {
      uuid: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      isLocked: false,
      isArchived: false,
      roles: [Role.Requester] as Role[],
      profilePictureUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    const listedPage = {
      users: [storedUser],
      total: 1,
      offset: 0,
      limit: 25,
    };

    it('returns the basic field view for non-admin callers (F10.1)', async () => {
      usersService.listUsers.mockResolvedValue(listedPage);

      const query: ListUsersQueryDto = {
        offset: 0,
        limit: 25,
        role: Role.Requester,
      };

      await expect(
        controller.listUsers(authenticatedRequest as never, query),
      ).resolves.toEqual({
        items: [
          {
            uuid: '11111111-1111-4111-8111-111111111111',
            displayName: 'Eve',
            email: 'eve@example.com',
            roles: [Role.Requester],
            profilePictureUrl: null,
          },
        ],
        total: 1,
        offset: 0,
        limit: 25,
        hasMore: false,
      });

      // Basic callers may filter by role (F10.3); admin flags never leave
      // the service.
      expect(usersService.listUsers).toHaveBeenCalledWith({
        role: Role.Requester,
        isAdmin: undefined,
        isLocked: undefined,
        isArchived: undefined,
        offset: 0,
        limit: 25,
      });
    });

    it('adds the account-management flags and filters for admins (F10.2/F10.4)', async () => {
      usersService.listUsers.mockResolvedValue(listedPage);
      const adminRequest = {
        user: { ...authenticatedRequest.user, isAdmin: true },
      };
      const query: ListUsersQueryDto = {
        offset: 0,
        limit: 25,
        isAdmin: false,
        isLocked: true,
        isArchived: false,
      };

      await expect(
        controller.listUsers(adminRequest as never, query),
      ).resolves.toEqual({
        items: [
          {
            uuid: '11111111-1111-4111-8111-111111111111',
            displayName: 'Eve',
            email: 'eve@example.com',
            roles: [Role.Requester],
            profilePictureUrl: null,
            isAdmin: false,
            isLocked: false,
            isArchived: false,
          },
        ],
        total: 1,
        offset: 0,
        limit: 25,
        hasMore: false,
      });

      expect(usersService.listUsers).toHaveBeenCalledWith({
        role: undefined,
        isAdmin: false,
        isLocked: true,
        isArchived: false,
        offset: 0,
        limit: 25,
      });
    });

    it('rejects admin-only filters from a non-admin caller outright', async () => {
      const query: ListUsersQueryDto = {
        offset: 0,
        limit: 25,
        isLocked: false,
      };

      await expect(
        controller.listUsers(authenticatedRequest as never, query),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.listUsers).not.toHaveBeenCalled();
    });

    it('reports hasMore when another page exists (N3.1.3)', async () => {
      usersService.listUsers.mockResolvedValue({
        users: [storedUser],
        total: 40,
        offset: 25,
        limit: 25,
      });

      await expect(
        controller.listUsers(
          authenticatedRequest as never,
          { offset: 25, limit: 25 } as ListUsersQueryDto,
        ),
      ).resolves.toMatchObject({ hasMore: true });
    });

    it('reports hasMore false on the final page (N3.1.3)', async () => {
      usersService.listUsers.mockResolvedValue({
        users: [storedUser, storedUser],
        total: 27,
        offset: 25,
        limit: 25,
      });

      await expect(
        controller.listUsers(
          authenticatedRequest as never,
          { offset: 25, limit: 25 } as ListUsersQueryDto,
        ),
      ).resolves.toMatchObject({ hasMore: false });
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

describe('list users query validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const queryMetadata = (metatype: Function) =>
    ({ type: 'query', metatype }) as const;

  it('defaults offset to 0 and limit to 25 (N3.1.2)', async () => {
    const value = await pipe.transform({}, queryMetadata(ListUsersQueryDto));
    expect(value.offset).toBe(0);
    expect(value.limit).toBe(25);
  });

  it('accepts explicit pagination and a role filter (F10.3)', async () => {
    const value = await pipe.transform(
      { offset: '50', limit: '100', role: 'courier' },
      queryMetadata(ListUsersQueryDto),
    );
    expect(value.offset).toBe(50);
    expect(value.limit).toBe(100);
    expect(value.role).toBe(Role.Courier);
  });

  it('accepts the admin-only flags as explicit booleans (F10.4)', async () => {
    const value = await pipe.transform(
      { isAdmin: 'true', isLocked: 'false', isArchived: 'true' },
      queryMetadata(ListUsersQueryDto),
    );
    expect(value.isAdmin).toBe(true);
    expect(value.isLocked).toBe(false);
    expect(value.isArchived).toBe(true);
  });

  it('rejects a limit above the 1000 hard ceiling (N3.1.1)', async () => {
    await expect(
      pipe.transform({ limit: '1001' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a zero limit', async () => {
    await expect(
      pipe.transform({ limit: '0' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a negative offset', async () => {
    await expect(
      pipe.transform({ offset: '-1' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-integer offset', async () => {
    await expect(
      pipe.transform({ offset: 'abc' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a role that is not a participant role', async () => {
    await expect(
      pipe.transform({ role: 'admin' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a garbage admin-only flag instead of coercing it', async () => {
    await expect(
      pipe.transform({ isAdmin: 'yes' }, queryMetadata(ListUsersQueryDto)),
    ).rejects.toThrow(BadRequestException);
  });
});
