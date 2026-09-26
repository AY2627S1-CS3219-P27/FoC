import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { User } from './user.entity.js';
import { EmailAlreadyRegisteredError, UsersService } from './users.service.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'ab'.repeat(64)),
}));

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userRepository = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 7, ...data })),
      count: vi.fn(async () => 0),
      findOneByOrFail: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    // The hashing helper is module-mocked; clear call history between tests
    // so call-count assertions only see the test under execution.
    vi.mocked(hashValue).mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('provisions a regular user active, unarchived and plain-flagged', async () => {
    const user = await service.provisionUser({
      email: 'eve@example.com',
      displayName: 'Eve',
      password: 'StrongPassw0rd!',
    });

    // Same M.1 F3.5 contract the registration flow relied on: a fresh
    // per-user salt, argon2id digest, active account — plus the new flags
    // defaulting to false.
    expect(userRepository.save).toHaveBeenCalledWith({
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isArchived: false,
      isAdmin: false,
      isLocked: false,
    });

    // Response exposes only the identifying fields, never the credentials.
    expect(user).toEqual({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
    });
  });

  it('provisions an admin account locked on request', async () => {
    await service.provisionUser({
      email: 'root@example.com',
      displayName: 'Root',
      password: 'discarded',
      isAdmin: true,
      isLocked: true,
    });

    expect(userRepository.save).toHaveBeenCalledWith({
      email: 'root@example.com',
      displayName: 'Root',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isArchived: false,
      isAdmin: true,
      isLocked: true,
    });
  });

  it('hashes the password with a fresh salt per provisioning', async () => {
    await service.provisionUser({
      email: 'a@example.com',
      displayName: 'A',
      password: 'pw-a',
    });
    await service.provisionUser({
      email: 'b@example.com',
      displayName: 'B',
      password: 'pw-b',
    });

    const salts = vi.mocked(hashValue).mock.calls.map((call) => call[1]);
    expect(salts).toHaveLength(2);
    expect(salts[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(salts[0]).not.toBe(salts[1]);
  });

  it('throws EmailAlreadyRegisteredError on a unique violation', async () => {
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    userRepository.save.mockRejectedValue(
      new QueryFailedError('INSERT INTO users', [], driverError),
    );

    await expect(
      service.provisionUser({
        email: 'eve@example.com',
        displayName: 'Eve',
        password: 'StrongPassw0rd!',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('counts only unarchived admins', async () => {
    userRepository.count.mockResolvedValue(3);

    await expect(service.countActiveAdmins()).resolves.toBe(3);
    expect(userRepository.count).toHaveBeenCalledWith({
      where: { isAdmin: true, isArchived: false },
    });
  });

  describe('checkUserAndReturnInfo', () => {
    // A full stored row whose hash matches the module-mocked hashValue digest
    // ('ab'.repeat(64) is 64 bytes in hex) and carries a 32-hex-char salt.
    const registeredUser = {
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: 'ab'.repeat(16),
      isActive: true,
      isAdmin: false,
      isLocked: false,
      isArchived: false,
    };

    it('returns the public info when the credentials match', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
      });

      // The supplied password is re-hashed with the stored salt for the
      // constant-time comparison.
      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        'StrongPassw0rd!',
        'ab'.repeat(16),
      );
      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({
        email: 'eve@example.com',
      });
    });

    it('rejects a wrong password as unauthorized', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown email as unauthorized, not a 500', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { email: 'ghost@example.com' }),
      );

      await expect(
        service.checkUserAndReturnInfo('ghost@example.com', 'Whatever123!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a locked account', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isLocked: true,
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an archived account', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isArchived: true,
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('fails the check instead of crashing on a corrupt stored hash', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        passwordHash: 'ab',
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow('db down');
    });
  });
});
