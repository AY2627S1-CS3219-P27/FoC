import { Test, TestingModule } from '@nestjs/testing';
import { OtpService } from './otp.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hashValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'deadbeef'),
}));

describe('OtpService', () => {
  let service: OtpService;
  let redis: {
    multi: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    hgetall: ReturnType<typeof vi.fn>;
    chain: {
      incr: ReturnType<typeof vi.fn>;
      expire: ReturnType<typeof vi.fn>;
      hset: ReturnType<typeof vi.fn>;
      exec: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    const chain = {
      incr: vi.fn(() => chain),
      expire: vi.fn(() => chain),
      hset: vi.fn(() => chain),
      exec: vi.fn(),
    };
    redis = {
      multi: vi.fn(() => chain),
      get: vi.fn(),
      hgetall: vi.fn(),
      chain,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOtpRequest', () => {
    it('bumps the generation counter and stores the record with its generation', async () => {
      redis.chain.exec
        .mockResolvedValueOnce([[null, 3]]) // incr result
        .mockResolvedValueOnce([
          [null, 3], // hset result
          [null, 1], // expire result
        ]);

      await service.createOtpRequest('eve@example.com');

      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        expect.stringMatching(/^eve@example\.com:/),
        'test-secret',
        16,
      );

      // Counter batch: incr + expire on the generation key.
      expect(redis.chain.incr).toHaveBeenCalledWith(
        'otp:count:eve@example.com',
      );
      expect(redis.chain.expire).toHaveBeenCalledWith(
        'otp:count:eve@example.com',
        3600,
      );

      // Record batch: hset + expire on the derived record key.
      expect(redis.chain.hset).toHaveBeenCalledWith('otp:deadbeef', {
        count: 3,
        issuedAt: expect.any(String),
      });
      expect(redis.chain.expire).toHaveBeenCalledWith('otp:deadbeef', 600);
    });

    it('keeps an existing OTP for the email valid only through its new generation', async () => {
      // First request issues generation 1...
      redis.chain.exec
        .mockResolvedValueOnce([[null, 1]])
        .mockResolvedValueOnce([
          [null, 1],
          [null, 1],
        ]);
      await service.createOtpRequest('eve@example.com');

      // ...a second request bumps it to 2.
      redis.chain.exec
        .mockResolvedValueOnce([[null, 2]])
        .mockResolvedValueOnce([
          [null, 2],
          [null, 1],
        ]);
      await service.createOtpRequest('eve@example.com');

      const firstRecord = redis.chain.hset.mock.calls[0][1];
      const secondRecord = redis.chain.hset.mock.calls[1][1];
      expect(firstRecord.count).toBe(1);
      expect(secondRecord.count).toBe(2);
    });
  });
});
