import { Test, TestingModule } from '@nestjs/testing';
import {
  OtpService,
  CREATE_OTP_SCRIPT,
  VALIDATE_OTP_SCRIPT,
} from './otp.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { EMAIL_SERVICE } from '../broker/broker.module.js';
import { hashValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'deadbeef'),
}));

describe('OtpService', () => {
  let service: OtpService;
  let emailClient: { emit: ReturnType<typeof vi.fn> };
  let redis: {
    eval: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    hgetall: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    redis = {
      eval: vi.fn(),
      get: vi.fn(),
      hgetall: vi.fn(),
    };

    emailClient = { emit: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        { provide: EMAIL_SERVICE, useValue: emailClient },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOtpRequest', () => {
    it('bumps the counter and stores the record in a single atomic script', async () => {
      redis.eval.mockResolvedValue(1);

      await service.createOtpRequest('eve@example.com');

      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        expect.stringMatching(/^eve@example\.com:/),
        'test-secret',
        16,
      );

      // One script, both keys, TTLs and the issuedAt stamp, in one round trip.
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(
        CREATE_OTP_SCRIPT,
        2,
        'otp:count:eve@example.com',
        'otp:deadbeef',
        3600,
        expect.any(String),
        600,
      );
    });

    it('stamps records with the incremented generation inside the script', () => {
      // The atomicity contract: the record's count comes from the INCR executed
      // inside the script, not from a client-read value. This is the behaviour
      // a host-side Redis guarantees, so it is pinned here at the unit level.
      expect(CREATE_OTP_SCRIPT).toContain(
        "local count = redis.call('INCR', KEYS[1])",
      );
      expect(CREATE_OTP_SCRIPT).toContain("'count', count, 'issuedAt'");
    });

    it('issues each request on the shared counter with its own record key', async () => {
      vi.mocked(hashValue)
        .mockResolvedValueOnce('deadbeef1')
        .mockResolvedValueOnce('deadbeef2');
      redis.eval.mockResolvedValue(1);

      await service.createOtpRequest('eve@example.com');
      await service.createOtpRequest('eve@example.com');

      // One atomic script per request: the email's counter is shared so
      // generations accumulate, while each OTP gets its own record key.
      expect(redis.eval).toHaveBeenCalledTimes(2);
      expect(redis.eval.mock.calls[0]).toEqual([
        CREATE_OTP_SCRIPT,
        2,
        'otp:count:eve@example.com',
        'otp:deadbeef1',
        3600,
        expect.any(String),
        600,
      ]);
      expect(redis.eval.mock.calls[1]).toEqual([
        CREATE_OTP_SCRIPT,
        2,
        'otp:count:eve@example.com',
        'otp:deadbeef2',
        3600,
        expect.any(String),
        600,
      ]);
    });

    it('emits the OTP to the email service over the broker', async () => {
      redis.eval.mockResolvedValue(1);

      await service.createOtpRequest('eve@example.com');

      expect(emailClient.emit).toHaveBeenCalledTimes(1);
      expect(emailClient.emit).toHaveBeenCalledWith(
        'otp.email',
        expect.objectContaining({
          messageId: expect.any(String),
          recipient: 'eve@example.com',
          otp: expect.stringMatching(/^[A-Za-z0-9_-]{6}$/),
          subject: 'Your OTP is here',
          expiry: 10,
        }),
      );
    });

    it('does not await email delivery, so broker hiccups do not fail the request', async () => {
      redis.eval.mockResolvedValue(1);

      await expect(
        service.createOtpRequest('eve@example.com'),
      ).resolves.toBeUndefined();
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateOtp', () => {
    it('derives the record key from email and otp and evals the validation script', async () => {
      redis.eval.mockResolvedValue(1);

      const valid = await service.validateOtp('eve@example.com', 'Ab3_-x9');

      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        'eve@example.com:Ab3_-x9',
        'test-secret',
        16,
      );
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(
        VALIDATE_OTP_SCRIPT,
        2,
        'otp:deadbeef',
        'otp:count:eve@example.com',
        expect.any(String),
      );
      expect(valid).toBe(true);
    });

    it('returns false when any F1.4 condition fails', async () => {
      redis.eval.mockResolvedValue(0);

      await expect(
        service.validateOtp('eve@example.com', 'Ab3_-x9'),
      ).resolves.toBe(false);
    });

    it('stamps consumedAt atomically and never deletes or extends the record', () => {
      // All failure modes collapse to a single 0, and the consumption datetime
      // is recorded in the same script that honours the F1.4 checks (so the
      // record is consumed before any associated action can run).
      expect(VALIDATE_OTP_SCRIPT).toContain('HGETALL');
      expect(VALIDATE_OTP_SCRIPT).toContain(
        "if fields['consumedAt'] ~= nil then",
      );
      expect(VALIDATE_OTP_SCRIPT).toContain(
        "tonumber(counter) ~= tonumber(fields['count'])",
      );
      expect(VALIDATE_OTP_SCRIPT).toContain(
        "redis.call('HSET', KEYS[1], 'consumedAt', ARGV[1])",
      );
      expect(VALIDATE_OTP_SCRIPT).not.toContain("'DEL'");
      expect(VALIDATE_OTP_SCRIPT).not.toContain("'EXPIRE'");
    });

    it('does not touch the email broker', async () => {
      redis.eval.mockResolvedValue(1);

      await service.validateOtp('eve@example.com', 'Ab3_-x9');

      expect(emailClient.emit).not.toHaveBeenCalled();
    });
  });
});
