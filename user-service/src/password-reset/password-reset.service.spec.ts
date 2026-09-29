import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PasswordResetService,
  CREATE_RESET_TOKEN_SCRIPT,
  RESET_PASSWORD_SCRIPT,
} from './password-reset.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { EMAIL_SERVICE } from '../broker/broker.module.js';
import { UsersService } from '../users/users.service.js';
import { hmacValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hmacValue: vi.fn(() => 'deadbeef'),
}));

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = 'eve@u.nus.edu';
const RECORD_KEY = 'resettoken:deadbeef';
const COUNTER_KEY = `resettoken:count:${EMAIL}`;

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let emailClient: { emit: ReturnType<typeof vi.fn> };
  let redis: {
    eval: ReturnType<typeof vi.fn>;
    hGetAll: ReturnType<typeof vi.fn>;
  };
  let usersService: {
    findActiveUserByEmail: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
  };
  let configService: { getOrThrow: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    redis = {
      eval: vi.fn(),
      // Default: a valid, un-redeemed record bound to the account.
      hGetAll: vi.fn(async () => ({
        count: '1',
        email: EMAIL,
        createdAt: new Date().toISOString(),
      })),
    };

    emailClient = { emit: vi.fn() };

    // Default to "active account found" so the happy path keeps issuing
    // tokens; the missing/archived tests flip this to null.
    usersService = {
      findActiveUserByEmail: vi.fn(async () => ({
        id: 7,
        email: EMAIL,
        displayName: 'Eve',
        roles: [],
        isAdmin: false,
      })),
      updatePassword: vi.fn(async () => undefined),
    };

    configService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'FRONTEND_BASE_URL') return 'http://localhost:5173';
        if (key === 'FRONTEND_PASSWORD_RESET_PATH') return '/reset-password';
        throw new Error(`Unexpected key ${key}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        { provide: EMAIL_SERVICE, useValue: emailClient },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);

    // The hashing helper is module-mocked; clear call history between tests so
    // call-count assertions only see the test under execution.
    vi.mocked(hmacValue).mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('requestReset', () => {
    it('bumps the per-account counter and stores the record in one script', async () => {
      redis.eval.mockResolvedValue(1);

      await service.requestReset(EMAIL);

      expect(vi.mocked(hmacValue)).toHaveBeenCalledWith(
        expect.stringMatching(TOKEN_PATTERN),
        'test-secret',
        32,
      );

      // One script with the counter key (keyed by email, like the OTP counter)
      // and the record key (hashed token). The counter outlives the record so
      // it is guaranteed alive for the record's whole lifetime.
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(CREATE_RESET_TOKEN_SCRIPT, {
        keys: [COUNTER_KEY, RECORD_KEY],
        arguments: ['3600', EMAIL, expect.any(String), '600'],
      });
    });

    it('stamps the incremented generation onto the record inside the script', () => {
      // The atomicity contract, as in the OTP flow: the record's generation
      // comes from the INCR executed inside the script, never from a
      // client-read value.
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain(
        'local count = redis.call("INCR", KEYS[1])',
      );
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain(
        '"count", count, "email"',
      );
    });

    it('keeps the counter TTL comfortably longer than the record TTL (F8.1.2)', () => {
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain(
        '"EXPIRE", KEYS[1], ARGV[1]',
      );
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain(
        '"EXPIRE", KEYS[2], ARGV[4]',
      );
    });

    it('stores the allowlist entry with the bound email and a 10-minute TTL', () => {
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain('"count"');
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain('"email"');
      expect(CREATE_RESET_TOKEN_SCRIPT).toContain('"createdAt"');
      // consumedAt is absent until redeemed (single-use).
      expect(CREATE_RESET_TOKEN_SCRIPT).not.toContain('"consumedAt"');
    });

    it('emits the reset link to the email service over the broker', async () => {
      redis.eval.mockResolvedValue(1);

      await service.requestReset(EMAIL);

      expect(emailClient.emit).toHaveBeenCalledTimes(1);
      const [, payload] = emailClient.emit.mock.calls[0];
      expect(emailClient.emit).toHaveBeenCalledWith(
        'password-reset.email',
        expect.objectContaining({
          messageId: expect.any(String),
          recipient: EMAIL,
          subject: 'Reset your password',
          expiry: 10,
        }),
      );
      // F8.2: the link carries the token, assembled from the frontend base URL
      // and reset path env vars.
      expect(payload.resetLink).toMatch(
        /^http:\/\/localhost:5173\/reset-password\?token=[A-Za-z0-9_-]{43}$/,
      );
    });

    it('does not await email delivery, so broker hiccups do not fail the request', async () => {
      redis.eval.mockResolvedValue(1);

      await expect(
        service.requestReset(EMAIL),
      ).resolves.toBeUndefined();
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });

    it('issues no token or email for an email with no active account', async () => {
      usersService.findActiveUserByEmail.mockResolvedValue(null);

      await expect(
        service.requestReset('ghost@example.com'),
      ).resolves.toBeUndefined();

      // Silently: no Redis record, no broker emit — the caller cannot tell an
      // account exists from any observable side effect.
      expect(usersService.findActiveUserByEmail).toHaveBeenCalledWith(
        'ghost@example.com',
      );
      expect(redis.eval).not.toHaveBeenCalled();
      expect(emailClient.emit).not.toHaveBeenCalled();
    });

    it('does not issue a token for an archived account', async () => {
      usersService.findActiveUserByEmail.mockResolvedValue(null);

      await service.requestReset('archived@example.com');

      expect(redis.eval).not.toHaveBeenCalled();
      expect(emailClient.emit).not.toHaveBeenCalled();
    });
  });

  describe('confirmReset', () => {
    it('peeks the bound email, redeems the token and re-hashes the password', async () => {
      // The Lua script validates (F8.4), stamps consumption (F8.5.1) and
      // returns the email bound at issuance.
      redis.eval.mockResolvedValue(EMAIL);

      await expect(
        service.confirmReset('someToken123', 'NewStrongPassw0rd!'),
      ).resolves.toBeUndefined();

      expect(vi.mocked(hmacValue)).toHaveBeenCalledWith(
        'someToken123',
        'test-secret',
        32,
      );
      // Read-only pre-read to derive the per-account counter key (the request
      // carries only the token), then one atomic script with both keys.
      expect(redis.hGetAll).toHaveBeenCalledWith(RECORD_KEY);
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(RESET_PASSWORD_SCRIPT, {
        keys: [RECORD_KEY, COUNTER_KEY],
        arguments: [expect.any(String)],
      });
      // F8.5.2: the account is resolved by the record-bound email and the new
      // password written for it — never for a client-supplied identifier.
      expect(usersService.findActiveUserByEmail).toHaveBeenCalledWith(EMAIL);
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        7,
        'NewStrongPassw0rd!',
      );
    });

    it('rejects with one generic error when the record is missing', async () => {
      redis.hGetAll.mockResolvedValue({});

      await expect(
        service.confirmReset('badToken', 'NewStrongPassw0rd!'),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset token.'),
      );

      expect(redis.eval).not.toHaveBeenCalled();
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('rejects with one generic error when the script rejects', async () => {
      redis.eval.mockResolvedValue(0);

      await expect(
        service.confirmReset('badToken', 'NewStrongPassw0rd!'),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset token.'),
      );
    });

    it('does not touch the password store on a rejected token', async () => {
      redis.eval.mockResolvedValue(0);

      await expect(
        service.confirmReset('badToken', 'NewStrongPassw0rd!'),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.updatePassword).not.toHaveBeenCalled();
      expect(usersService.findActiveUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects with one generic error when the account was archived mid-flight', async () => {
      // The record is fine and the script consumes it, but the account is no
      // longer active by redemption time: same generic error, no password write.
      redis.eval.mockResolvedValue(EMAIL);
      usersService.findActiveUserByEmail.mockResolvedValue(null);

      await expect(
        service.confirmReset('someToken', 'NewStrongPassw0rd!'),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset token.'),
      );

      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('fails validation in the Lua script for every condition alike (F8.4.2)', () => {
      // Every rejected branch returns the same 0: unknown/expired (evicted
      // record), already consumed, or superseded by a newer token (generation
      // mismatch) are indistinguishable.
      expect(RESET_PASSWORD_SCRIPT).toContain('return 0');
      expect(RESET_PASSWORD_SCRIPT).toContain('fields["consumedAt"]');
      // F8.1.2: the counter holds the newest generation; anything older is
      // implicitly revoked.
      expect(RESET_PASSWORD_SCRIPT).toContain(
        'tonumber(fields["count"])',
      );
      // F8.5.1: consumption is stamped atomically on success.
      expect(RESET_PASSWORD_SCRIPT).toContain('"consumedAt", ARGV[1]');
      // The email comes from the record, never from client input.
      expect(RESET_PASSWORD_SCRIPT).toContain('return fields["email"]');
    });

    it('propagates redis failures', async () => {
      redis.eval.mockRejectedValue(new Error('redis down'));

      await expect(
        service.confirmReset('someToken', 'NewStrongPassw0rd!'),
      ).rejects.toThrow('redis down');
    });
  });
});