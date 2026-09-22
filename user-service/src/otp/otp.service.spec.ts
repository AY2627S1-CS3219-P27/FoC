import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OtpService, CREATE_OTP_SCRIPT } from './otp.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hashValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'deadbeef'),
}));

describe('OtpService', () => {
  let service: OtpService;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        {
          // No email is sent in these tests: an unset endpoint makes
          // sendOtpEmail warn and skip delivery.
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
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
  });
});