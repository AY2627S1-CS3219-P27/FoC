import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@foc/contracts';
import type { AuthenticatedUser } from '../authenticated-user.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  class StubController {
    @Roles(Role.Requester)
    requesterOnly() {}

    @Roles(Role.Requester, Role.Courier)
    requesterOrCourier() {}

    unrestricted() {}

    @Roles()
    noRolesDeclared() {}
  }

  const contextFor = (method: keyof StubController, user: AuthenticatedUser) =>
    ({
      getHandler: () => StubController.prototype[method],
      getClass: () => StubController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as never;

  const userWith = (roles: Role[]): AuthenticatedUser => ({
    sub: 7,
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin: false,
    roles,
  });

  it('allows a user holding the single required role', () => {
    expect(
      guard.canActivate(
        contextFor('requesterOnly', userWith([Role.Requester])),
      ),
    ).toBe(true);
  });

  it('allows a user holding at least one of several required roles', () => {
    expect(
      guard.canActivate(
        contextFor('requesterOrCourier', userWith([Role.Courier])),
      ),
    ).toBe(true);
  });

  it('rejects a user holding none of the required roles', () => {
    expect(() =>
      guard.canActivate(contextFor('requesterOnly', userWith([Role.Courier]))),
    ).toThrow(ForbiddenException);
  });

  it('rejects when the user holds no roles at all', () => {
    expect(() =>
      guard.canActivate(contextFor('requesterOnly', userWith([]))),
    ).toThrow(ForbiddenException);
  });

  it('allows unrestricted routes without @Roles metadata', () => {
    expect(guard.canActivate(contextFor('unrestricted', userWith([])))).toBe(
      true,
    );
  });

  it('treats an empty @Roles() declaration as no restriction', () => {
    expect(guard.canActivate(contextFor('noRolesDeclared', userWith([])))).toBe(
      true,
    );
  });
});
