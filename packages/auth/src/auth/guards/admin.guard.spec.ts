import { ForbiddenException } from '@nestjs/common';
import { Role } from '@foc/contracts';
import type { AuthenticatedUser } from '../authenticated-user.js';
import { AdminGuard } from './admin.guard.js';

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  const contextFor = (user: AuthenticatedUser) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as never;

  const userWith = (isAdmin: boolean): AuthenticatedUser => ({
    sub: '11111111-1111-4111-8111-111111111111',
    email: 'eve@example.com',
    displayName: 'Eve',
    isAdmin,
    roles: [Role.Requester],
  });

  it('allows an admin user', () => {
    expect(guard.canActivate(contextFor(userWith(true)))).toBe(true);
  });

  it('rejects a non-admin user', () => {
    expect(() => guard.canActivate(contextFor(userWith(false)))).toThrow(
      ForbiddenException,
    );
  });
});
