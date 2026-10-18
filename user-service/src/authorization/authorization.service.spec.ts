import { Test, TestingModule } from '@nestjs/testing';
import { AuthorizationService } from './authorization.service.js';
import { REDIS } from '../redis/redis.provider.js';
import { BLOCK_EXPIRATION_IN_SECONDS } from '../common/constants.js';
import { adminBlockKey } from '../common/hash/token-keys.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let redis: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Default: no block present, so the happy path stays unblocked.
    redis = {
      set: vi.fn(),
      get: vi.fn(async () => null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthorizationService, { provide: REDIS, useValue: redis }],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
  });

  describe('createAdminBlock', () => {
    it('sets the block key with the block TTL', async () => {
      await service.createAdminBlock(UUID);

      expect(redis.set).toHaveBeenCalledWith(adminBlockKey(UUID), 1, {
        EX: BLOCK_EXPIRATION_IN_SECONDS,
      });
    });

    it('swallows Redis errors: the demotion is already committed', async () => {
      redis.set.mockRejectedValue(new Error('redis down'));

      await expect(service.createAdminBlock(UUID)).resolves.toBeUndefined();
    });
  });

  describe('checkIsAdminBlocked', () => {
    it('is true when the block key exists', async () => {
      redis.get.mockResolvedValue('1');

      await expect(service.checkIsAdminBlocked(UUID)).resolves.toBe(true);
    });

    it('is false when the block key is absent', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.checkIsAdminBlocked(UUID)).resolves.toBe(false);
    });
  });
});
