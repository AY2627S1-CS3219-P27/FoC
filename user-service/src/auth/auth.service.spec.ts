import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, REGISTER_USER_SCRIPT } from './auth.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hmacValue } from '../common/hash/hash.js';
import {
  EmailAlreadyRegisteredError,
  UsersService,
} from '../users/users.service.js';
import { Role } from '../users/role.js';

vi.mock('../common/hash/hash.js', () => ({
  hmacValue: vi.fn(() => 'deadbeef'),
  hashValue: vi.fn(async () => 'ab'.repeat(64)),
}));

describe('AuthService', () => {
  let service: AuthService;
  let redis: { eval: ReturnType<typeof vi.fn> };
  let usersService: {
    provisionUser: ReturnType<typeof vi.fn>;
    checkUserAndReturnInfo: ReturnType<typeof vi.fn>;
  };
  let jwtService: { signAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    redis = { eval: vi.fn() };
    usersService = {
      provisionUser: vi.fn(async (args) => ({
        id: 7,
        email: args.email,
        displayName: args.displayName,
        roles: [],
        isAdmin: false,
      })),
      checkUserAndReturnInfo: vi.fn(),
    };
    jwtService = { signAsync: vi.fn(async () => 'signed-jwt') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        { provide: UsersService, useValue: usersService },
        // AuthService also issues JWTs on login; stubbed here since the
        // registration flow under test never signs.
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // The hashing helpers are module-mocked; clear call history between tests
    // so call-count assertions only see the test under execution.
    vi.mocked(hmacValue).mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('derives the token key and evals the registration script', async () => {
    redis.eval.mockResolvedValue('eve@example.com');

    await service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!');

    // The key is derived with the same shared function the OTP service uses
    // to issue the record, keyed on the server secret.
    expect(vi.mocked(hmacValue)).toHaveBeenCalledWith(
      'some-token',
      'test-secret',
      32,
    );

    // One script, one key and the consumption stamp, in one round trip.
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(REGISTER_USER_SCRIPT, {
      keys: ['regtoken:deadbeef'],
      arguments: [expect.any(String)],
    });
  });

  it('provisions the account bound to the token via the shared user flow', async () => {
    redis.eval.mockResolvedValue('eve@example.com');

    const user = await service.registerWithToken(
      'some-token',
      'Eve',
      'StrongPassw0rd!',
    );

    // The token's bound email feeds the shared provisioning path (the same
    // one the admin bootstrap uses), with regular-user flag defaults.
    expect(usersService.provisionUser).toHaveBeenCalledWith({
      email: 'eve@example.com',
      displayName: 'Eve',
      password: 'StrongPassw0rd!',
    });

    // Response exposes the public profile: identifying fields, the role set
    // (empty until opt-in) and the admin classification — never credentials.
    expect(user).toEqual({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      roles: [],
      isAdmin: false,
    });
  });

  it('rejects when any token validation condition fails', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow('Invalid Registration Token');

    // No account is provisioned on a rejected token.
    expect(usersService.provisionUser).not.toHaveBeenCalled();
  });

  it('maps an already-registered email to a conflict', async () => {
    redis.eval.mockResolvedValue('eve@example.com');
    usersService.provisionUser.mockRejectedValue(
      new EmailAlreadyRegisteredError(),
    );

    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow(ConflictException);
  });

  it('rethrows provisioning failures that are not email conflicts', async () => {
    redis.eval.mockResolvedValue('eve@example.com');
    usersService.provisionUser.mockRejectedValue(new Error('db down'));

    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow('db down');
  });

  it('validates and consumes the token atomically in one script', () => {
    // All rejected conditions (unknown/expired, already consumed) collapse to
    // a single 0 before the record is touched, and the consumption stamp
    // shares the script with the checks so a token can never be consumed
    // without being validated (nor replayed for a second account).
    expect(REGISTER_USER_SCRIPT).toContain('HGETALL');
    expect(REGISTER_USER_SCRIPT).toContain(
      'if fields["consumedAt"] ~= nil then',
    );
    expect(REGISTER_USER_SCRIPT).toContain(
      'redis.call("HSET", KEYS[1], "consumedAt", ARGV[1])',
    );
    expect(REGISTER_USER_SCRIPT).toContain('return fields["email"]');
  });

  it('never deletes or extends the registration token record', () => {
    expect(REGISTER_USER_SCRIPT).not.toContain('"DEL"');
    expect(REGISTER_USER_SCRIPT).not.toContain('"EXPIRE", KEYS[1]');
  });

  describe('checkCredentials', () => {
    it('signs a JWT carrying the user identity and roles when the credentials match', async () => {
      usersService.checkUserAndReturnInfo.mockResolvedValue({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        isAdmin: false,
        roles: [Role.Requester, Role.Courier],
      });

      await expect(
        service.checkCredentials('eve@example.com', 'StrongPassw0rd!'),
      ).resolves.toEqual({ accessToken: 'signed-jwt' });

      expect(usersService.checkUserAndReturnInfo).toHaveBeenCalledWith(
        'eve@example.com',
        'StrongPassw0rd!',
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 7,
        displayName: 'Eve',
        email: 'eve@example.com',
        isAdmin: false,
        roles: [Role.Requester, Role.Courier],
      });
    });

    it('propagates rejected credentials without signing a token', async () => {
      usersService.checkUserAndReturnInfo.mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(
        service.checkCredentials('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});