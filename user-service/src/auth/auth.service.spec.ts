import { Test, TestingModule } from '@nestjs/testing';
import { AuthService, REGISTER_USER_SCRIPT } from './auth.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hmacValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hmacValue: vi.fn(() => 'deadbeef'),
}));

describe('AuthService', () => {
  let service: AuthService;
  let redis: { eval: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    redis = { eval: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // The hashing helper is module-mocked; clear call history between tests so
    // call-count assertions only see the test under execution.
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

  it('returns the email bound to the token on success', async () => {
    redis.eval.mockResolvedValue('eve@example.com');

    const email = await service.registerWithToken(
      'some-token',
      'Eve',
      'StrongPassw0rd!',
    );

    expect(email).toBe('eve@example.com');
  });

  it('rejects when any validation condition fails', async () => {
    redis.eval.mockResolvedValue(0);

    // The service deliberately 401s on an invalid/consumed token: a null
    // result from the script collapses every rejection condition into a
    // single UnauthorizedException, so registerWithToken never resolves null.
    await expect(
      service.registerWithToken('some-token', 'Eve', 'StrongPassw0rd!'),
    ).rejects.toThrow('Invalid Registration Token');
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
