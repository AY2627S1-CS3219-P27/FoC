import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { AuthService, REGISTER_USER_SCRIPT } from './auth.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hmacValue, hashValue } from '../common/hash/hash.js';
import { User } from '../users/user.entity.js';

vi.mock('../common/hash/hash.js', () => ({
  hmacValue: vi.fn(() => 'deadbeef'),
  hashValue: vi.fn(async () => 'ab'.repeat(64)),
}));

describe('AuthService', () => {
  let service: AuthService;
  let redis: { eval: ReturnType<typeof vi.fn> };
  let userRepository: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    redis = { eval: vi.fn() };
    userRepository = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 7, ...data })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // The hashing helpers are module-mocked; clear call history between tests
    // so call-count assertions only see the test under execution.
    vi.mocked(hmacValue).mockClear();
    vi.mocked(hashValue).mockClear();
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

  it('provisions the account bound to the token', async () => {
    redis.eval.mockResolvedValue('eve@example.com');

    const user = await service.registerWithToken(
      'some-token',
      'Eve',
      'StrongPassw0rd!',
    );

    // Account carries the token's bound email, a fresh per-user salt and the
    // argon2id digest, and starts active.
    expect(userRepository.save).toHaveBeenCalledWith({
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isActive: true,
    });

    // Response exposes only the identifying fields, never the credentials.
    expect(user).toEqual({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
    });
  });

  it('hashes the password with a fresh salt per registration', async () => {
    redis.eval.mockResolvedValue('eve@example.com');

    await service.registerWithToken('token-a', 'Eve', 'StrongPassw0rd!');
    await service.registerWithToken('token-b', 'Eve', 'StrongPassw0rd!');

    const args = vi.mocked(hashValue).mock.calls.map((call) => call[1]);
    expect(args).toHaveLength(2);
    expect(args[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(args[0]).not.toBe(args[1]);
  });

  it('rejects when any token validation condition fails', async () => {
    redis.eval.mockResolvedValue(0);

    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow('Invalid Registration Token');

    // No account is provisioned on a rejected token.
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('conflicts when the bound email is already registered', async () => {
    redis.eval.mockResolvedValue('eve@example.com');
    userRepository.save.mockRejectedValue(
      new QueryFailedError('INSERT INTO users', [], { code: '23505' }),
    );

    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow(ConflictException);
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
});