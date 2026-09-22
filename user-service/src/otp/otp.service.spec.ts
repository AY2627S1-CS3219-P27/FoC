import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OtpService, CREATE_OTP_SCRIPT } from './otp.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hashValue } from '../common/hash/hash.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'deadbeef'),
}));

const EMAIL_SERVICE_ENDPOINT = 'http://email-service:3000/email';

describe('OtpService', () => {
  let service: OtpService;
  let config: { getOrThrow: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;
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

    config = {
      getOrThrow: vi.fn(() => EMAIL_SERVICE_ENDPOINT),
    };

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: REDIS, useValue: redis },
        {
          provide: SecretService,
          useValue: { getServerSecret: () => 'test-secret' },
        },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    it('posts the OTP to the configured email endpoint', async () => {
      redis.eval.mockResolvedValue(1);

      await service.createOtpRequest('eve@example.com');

      expect(config.getOrThrow).toHaveBeenCalledWith('EMAIL_SERVICE_ENDPOINT');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(url).toBe(EMAIL_SERVICE_ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(init.body) as {
        type: string;
        recipient: string;
        content: { subject: string; expiry: number; otp: string };
      };
      expect(body.type).toBe('OTP');
      expect(body.recipient).toBe('eve@example.com');
      expect(body.content).toEqual({
        subject: 'Your OTP',
        expiry: 10,
        otp: expect.any(String),
      });
      expect(body.content.otp).toMatch(/^[A-Za-z0-9_-]{6}$/);
    });

    it('fails the request when the email endpoint is not configured', async () => {
      redis.eval.mockResolvedValue(1);
      config.getOrThrow.mockImplementation(() => {
        throw new Error('EMAIL_SERVICE_ENDPOINT is not set');
      });

      await expect(
        service.createOtpRequest('eve@example.com'),
      ).rejects.toThrow('EMAIL_SERVICE_ENDPOINT is not set');

      // The OTP record was still stored before the email step; no delivery attempted.
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still succeeds when the email service is unreachable', async () => {
      redis.eval.mockResolvedValue(1);
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.createOtpRequest('eve@example.com'),
      ).resolves.toBeUndefined();
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });

    it('still succeeds when the email service returns an error status', async () => {
      redis.eval.mockResolvedValue(1);
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        service.createOtpRequest('eve@example.com'),
      ).resolves.toBeUndefined();
      expect(redis.eval).toHaveBeenCalledTimes(1);
    });
  });
});