import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import {
  EmailAlreadyRegisteredError,
  UsersService,
} from '../users/users.service.js';

describe('AdminBootstrapService', () => {
  let service: AdminBootstrapService;
  let usersService: {
    countActiveAdmins: ReturnType<typeof vi.fn>;
    provisionUser: ReturnType<typeof vi.fn>;
  };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    usersService = {
      countActiveAdmins: vi.fn(async () => 0),
      provisionUser: vi.fn(async (args) => ({ id: 1, ...args })),
    };
    configService = {
      get: vi.fn((key: string) =>
        key === 'ADMIN_BOOTSTRAP_EMAIL' ? 'admin@example.com' : 'System Admin',
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBootstrapService,
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AdminBootstrapService>(AdminBootstrapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does nothing when an unarchived admin is present', async () => {
    usersService.countActiveAdmins.mockResolvedValue(1);

    const logger = vi
      .spyOn(service['logger'], 'debug')
      .mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    expect(logger).toHaveBeenCalled();
    expect(usersService.provisionUser).not.toHaveBeenCalled();
  });

  it('logs and skips when env config is missing and no admins exist', async () => {
    configService.get.mockReturnValue(undefined);

    const warn = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    // M.1 F14.3: log the missing config without provisioning anything.
    expect(warn).toHaveBeenCalled();
    expect(usersService.provisionUser).not.toHaveBeenCalled();
  });

  it('provisions a locked, active admin with a random discarded password', async () => {
    const logger = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    // F14.1: email + display name come from the environment.
    expect(usersService.provisionUser).toHaveBeenCalledWith({
      email: 'admin@example.com',
      displayName: 'System Admin',
      // F14.2.4: a random 32-byte password is generated for provisioning.
      password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      isAdmin: true,
      isLocked: true,
    });
    expect(logger).toHaveBeenCalled();
  });

  it('logs an error and continues when the email collides with a regular user', async () => {
    usersService.provisionUser.mockRejectedValue(
      new EmailAlreadyRegisteredError(),
    );

    const error = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    // The default countActiveAdmins mock returns 0, so the post-conflict
    // re-check confirms no admin now exists — a real user owns the email.
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('treats a unique violation as a won race when an admin exists on re-check', async () => {
    usersService.provisionUser.mockRejectedValue(
      new EmailAlreadyRegisteredError(),
    );
    // First count sees zero admins (why we attempted), the post-conflict
    // re-check sees the concurrent winner's committed row.
    usersService.countActiveAdmins
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const error = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    const log = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Bootstrap admin already provisioned (concurrent bootstrap); continuing.',
    );
  });

  it('logs an error and continues when provisioning fails', async () => {
    usersService.provisionUser.mockRejectedValue(new Error('db down'));

    const error = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
