import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AdminBlockGuard } from './admin-block.guard.js';
import { AuthorizationService } from '../authorization.service.js';

const SUB = '11111111-1111-4111-8111-111111111111';

const contextFor = (user?: { sub: string }) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('AdminBlockGuard', () => {
  let guard: AdminBlockGuard;
  let authorizationService: {
    checkIsAdminBlocked: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Default: no block, so the happy path passes.
    authorizationService = {
      checkIsAdminBlocked: vi.fn(async () => false),
    };

    guard = new AdminBlockGuard(
      authorizationService as unknown as AuthorizationService,
    );
  });

  it('allows an admin without a block', async () => {
    await expect(guard.canActivate(contextFor({ sub: SUB }))).resolves.toBe(
      true,
    );
  });

  it('rejects a blocked admin with 403', async () => {
    authorizationService.checkIsAdminBlocked.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextFor({ sub: SUB })),
    ).rejects.toMatchObject({
      constructor: ForbiddenException,
      message: 'Admin access has been revoked',
    });
  });

  it('fails closed when the block status cannot be verified', async () => {
    authorizationService.checkIsAdminBlocked.mockRejectedValue(
      new Error('redis down'),
    );

    await expect(
      guard.canActivate(contextFor({ sub: SUB })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects requests without an authenticated user', async () => {
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authorizationService.checkIsAdminBlocked).not.toHaveBeenCalled();
  });
});
