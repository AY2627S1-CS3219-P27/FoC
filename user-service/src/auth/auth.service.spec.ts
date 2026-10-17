import { Test, TestingModule } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService, REGISTER_USER_SCRIPT } from './auth.service.js';
import { RefreshToken } from './refresh-token.entity.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hmacValue } from '../common/hash/hash.js';
import { JWT_EXPIRATION_IN_SECONDS } from '../common/constants.js';
import { Role, validateAccessTokenPayload } from '@foc/contracts';
import {
  EmailAlreadyRegisteredError,
  UsersService,
} from '../users/users.service.js';

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
    getUserByUuid: ReturnType<typeof vi.fn>;
  };
  let jwtService: { signAsync: ReturnType<typeof vi.fn> };
  let refreshTokenRepository: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    redis = { eval: vi.fn() };
    usersService = {
      provisionUser: vi.fn(async (args) => ({
        uuid: '11111111-1111-4111-8111-111111111111',
        email: args.email,
        displayName: args.displayName,
        roles: [],
        isAdmin: false,
      })),
      checkUserAndReturnInfo: vi.fn(),
      getUserByUuid: vi.fn(),
    };
    jwtService = { signAsync: vi.fn(async () => 'signed-jwt') };
    refreshTokenRepository = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ ...data })),
      delete: vi.fn(),
      findOneBy: vi.fn(),
      update: vi.fn(),
    };

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
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
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
      uuid: '11111111-1111-4111-8111-111111111111',
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
    const matchingUser = {
      uuid: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester, Role.Courier],
    };

    it('signs a JWT carrying the user identity and roles when the credentials match', async () => {
      usersService.checkUserAndReturnInfo.mockResolvedValue(matchingUser);

      const { accessToken, refreshToken } = await service.checkCredentials(
        'eve@example.com',
        'StrongPassw0rd!',
      );

      expect(usersService.checkUserAndReturnInfo).toHaveBeenCalledWith(
        'eve@example.com',
        'StrongPassw0rd!',
      );
      // Only the access token is a JWT; the refresh token is a raw opaque
      // value, so the signer is invoked exactly once.
      expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: '11111111-1111-4111-8111-111111111111',
        displayName: 'Eve',
        email: 'eve@example.com',
        isAdmin: false,
        roles: [Role.Requester, Role.Courier],
      });
      expect(accessToken).toBe('signed-jwt');
      // 32 random bytes, hex-encoded -> 64 hex characters.
      expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores the hashed refresh token, never the plaintext', async () => {
      usersService.checkUserAndReturnInfo.mockResolvedValue(matchingUser);

      const { refreshToken } = await service.checkCredentials(
        'eve@example.com',
        'StrongPassw0rd!',
      );

      // hmacValue is module-mocked to 'deadbeef'; the persisted record carries
      // the keyed digest, not the raw token handed back to the caller.
      expect(refreshTokenRepository.create).toHaveBeenCalledWith({
        hashedToken: 'deadbeef',
        userId: '11111111-1111-4111-8111-111111111111',
      });
      expect(refreshTokenRepository.save).toHaveBeenCalledTimes(1);
      expect(refreshToken).not.toBe('deadbeef');
    });

    it('leaves previously issued tokens in place (multi-session)', async () => {
      usersService.checkUserAndReturnInfo.mockResolvedValue(matchingUser);

      await service.checkCredentials('eve@example.com', 'StrongPassw0rd!');

      // Logging in on one device must not revoke other devices' sessions.
      expect(refreshTokenRepository.delete).not.toHaveBeenCalled();
    });

    it('propagates a failed refresh-token persist without signing an access token', async () => {
      usersService.checkUserAndReturnInfo.mockResolvedValue(matchingUser);
      refreshTokenRepository.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.checkCredentials('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow('db down');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
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

  describe('refreshSession', () => {
    const refreshedUser = {
      uuid: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
    };
    const validRecord = {
      hashedToken: 'deadbeef',
      userId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
    };

    it('signs a fresh access token for the session bound to a valid token', async () => {
      refreshTokenRepository.findOneBy.mockResolvedValue(validRecord);
      usersService.getUserByUuid.mockResolvedValue(refreshedUser);

      await expect(service.refreshSession('opaque-token')).resolves.toEqual({
        accessToken: 'signed-jwt',
      });

      // The lookup is keyed on the HMAC of the presented token, not the raw
      // value (2-arg form; the registration path uses the 3-arg override).
      expect(vi.mocked(hmacValue)).toHaveBeenCalledWith(
        'opaque-token',
        'test-secret',
      );
      expect(refreshTokenRepository.findOneBy).toHaveBeenCalledWith({
        hashedToken: 'deadbeef',
      });
      expect(usersService.getUserByUuid).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: '11111111-1111-4111-8111-111111111111',
        displayName: 'Eve',
        email: 'eve@example.com',
        isAdmin: false,
        roles: [Role.Requester],
      });
    });

    it.each([
      {
        name: 'an unknown token',
        setup: () => refreshTokenRepository.findOneBy.mockResolvedValue(null),
      },
      {
        name: 'an expired token',
        setup: () =>
          refreshTokenRepository.findOneBy.mockResolvedValue({
            ...validRecord,
            expiresAt: new Date(0),
          }),
      },
      {
        name: 'a token bound to a pruned account',
        setup: () => {
          refreshTokenRepository.findOneBy.mockResolvedValue(validRecord);
          usersService.getUserByUuid.mockResolvedValue(null);
        },
      },
    ])('rejects $name with the identical generic error (F5.2)', ({ setup }) => {
      setup();

      // F5.2: every failed F5.1 condition must reject indistinguishably — the
      // caller learns "invalid", never which condition failed. A differing
      // message would surface here.
      return expect(service.refreshSession('opaque-token')).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('never signs a token for a failed condition', async () => {
      refreshTokenRepository.findOneBy.mockResolvedValue(null);

      await expect(service.refreshSession('opaque-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('revokeRefreshToken', () => {
    it('revokes exactly the presented token by its HMAC', async () => {
      await service.revokeRefreshToken('opaque-token');

      // The revocation is keyed on the HMAC of the raw token, matching how the
      // session record is stored and looked up on refresh.
      expect(vi.mocked(hmacValue)).toHaveBeenCalledWith(
        'opaque-token',
        'test-secret',
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { hashedToken: 'deadbeef' },
        { expiresAt: expect.any(Date) },
      );
      // Device-scoped: no other rows are touched.
      expect(refreshTokenRepository.update).toHaveBeenCalledTimes(1);
    });

    it('records the revocation datetime as the moment of revocation (F7.1.2)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));

      await service.revokeRefreshToken('opaque-token');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { hashedToken: 'deadbeef' },
        { expiresAt: new Date('2026-10-17T12:00:00Z') },
      );

      vi.useRealTimers();
    });
  });

  describe('revokeAllRefreshTokens', () => {
    it('revokes every token for the account in a single statement (F7.2.1)', async () => {
      await service.revokeAllRefreshTokens(
        '11111111-1111-4111-8111-111111111111',
      );

      // One update, keyed on the user, stamps every row with the same value.
      expect(refreshTokenRepository.update).toHaveBeenCalledTimes(1);
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: '11111111-1111-4111-8111-111111111111' },
        { expiresAt: expect.any(Date) },
      );
    });
  });
});

describe('access token contract conformance', () => {
  it('mints a token that passes the access-token contract', async () => {
    // Real signer with the same options wired in AuthModule, so this asserts
    // the full issued shape — including the `iss` and timestamps the JWT
    // library emits — not just the identity claims. Issuer drift breaks this
    // test first, before any verifier sees a token.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const realJwtService = new JwtService({
      privateKey,
      publicKey,
      signOptions: {
        expiresIn: JWT_EXPIRATION_IN_SECONDS,
        issuer: 'user-service',
        algorithm: 'RS256',
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS, useValue: { eval: vi.fn() } },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        {
          provide: UsersService,
          useValue: {
            checkUserAndReturnInfo: vi.fn(async () => ({
              uuid: '11111111-1111-4111-8111-111111111111',
              email: 'eve@example.com',
              displayName: 'Eve',
              isAdmin: false,
              roles: [Role.Requester],
            })),
            getUserByUuid: vi.fn(async () => ({
              uuid: '11111111-1111-4111-8111-111111111111',
              email: 'eve@example.com',
              displayName: 'Eve',
              isAdmin: false,
              roles: [Role.Requester],
            })),
          },
        },
        { provide: JwtService, useValue: realJwtService },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            create: vi.fn((data) => data),
            save: vi.fn(async (data) => ({ ...data })),
            delete: vi.fn(),
            findOneBy: vi.fn(async () => ({
              hashedToken: 'deadbeef',
              userId: '11111111-1111-4111-8111-111111111111',
              expiresAt: new Date(Date.now() + 60_000),
              issuedAt: new Date(),
            })),
          },
        },
      ],
    }).compile();
    const service = module.get<AuthService>(AuthService);

    const { accessToken } = await service.checkCredentials(
      'eve@example.com',
      'StrongPassw0rd!',
    );
    const payload = await realJwtService.verifyAsync(accessToken);

    const result = validateAccessTokenPayload(payload);

    expect(result.valid).toBe(true);
    expect(result.valid && result.value).toMatchObject({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
      iss: 'user-service',
    });
  });

  it('mints a refreshed token with the same fields as a login token (F5.3)', async () => {
    // Same real signer + contract validator as the login conformance test:
    // asserts a refreshed access token is shaped identically to one issued at
    // login, not just that a JWT came back.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const realJwtService = new JwtService({
      privateKey,
      publicKey,
      signOptions: {
        expiresIn: JWT_EXPIRATION_IN_SECONDS,
        issuer: 'user-service',
        algorithm: 'RS256',
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS, useValue: { eval: vi.fn() } },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        {
          provide: UsersService,
          useValue: {
            getUserByUuid: vi.fn(async () => ({
              uuid: '11111111-1111-4111-8111-111111111111',
              email: 'eve@example.com',
              displayName: 'Eve',
              isAdmin: false,
              roles: [Role.Requester],
            })),
          },
        },
        { provide: JwtService, useValue: realJwtService },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            findOneBy: vi.fn(async () => ({
              hashedToken: 'deadbeef',
              userId: '11111111-1111-4111-8111-111111111111',
              expiresAt: new Date(Date.now() + 60_000),
              issuedAt: new Date(),
            })),
          },
        },
      ],
    }).compile();
    const service = module.get<AuthService>(AuthService);

    const { accessToken } = await service.refreshSession('opaque-token');
    const payload = await realJwtService.verifyAsync(accessToken);

    const result = validateAccessTokenPayload(payload);

    expect(result.valid).toBe(true);
    expect(result.valid && result.value).toMatchObject({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'eve@example.com',
      displayName: 'Eve',
      isAdmin: false,
      roles: [Role.Requester],
      iss: 'user-service',
    });
  });
});
