import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { ArrayContains, EntityNotFoundError, QueryFailedError } from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { Role } from '@foc/contracts';
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
    findOneBy: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userRepository = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 7, ...data })),
      count: vi.fn(async () => 0),
      findOneBy: vi.fn(),
      findOneByOrFail: vi.fn(),
      exists: vi.fn(async () => false),
      findAndCount: vi.fn(),
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

    // Same contract the registration flow relied on: a fresh
    // per-user salt, argon2id digest, active account — plus the new flags
    // defaulting to false and no participant roles until the user opts in.
    expect(userRepository.save).toHaveBeenCalledWith({
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isArchived: false,
      isAdmin: false,
      isLocked: false,
      roles: [],
    });

    // Response exposes the public profile: identifying fields, the role set
    // (empty until opt-in) and the admin classification — never credentials.
    expect(user).toEqual({
      id: 7,
      email: 'eve@example.com',
      displayName: 'Eve',
      roles: [],
      isAdmin: false,
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
      roles: [],
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
    roles: [],
  };

  describe('existsByEmail', () => {
    it('reports true when a matching account exists', async () => {
      userRepository.exists.mockResolvedValue(true);

      await expect(service.existsByEmail('eve@example.com')).resolves.toBe(
        true,
      );
      expect(userRepository.exists).toHaveBeenCalledWith({
        where: { email: 'eve@example.com' },
      });
    });

    it('reports false when no account exists', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(service.existsByEmail('ghost@example.com')).resolves.toBe(
        false,
      );
    });
  });

  describe('findActiveUserByEmail', () => {
    it('returns an un-archived account tied to the email', async () => {
      userRepository.findOneBy.mockResolvedValue(registeredUser);

      await expect(
        service.findActiveUserByEmail('eve@example.com'),
      ).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [],
        isAdmin: false,
      });
      expect(userRepository.findOneBy).toHaveBeenCalledWith({
        email: 'eve@example.com',
        isArchived: false,
      });
    });

    it('returns null when no un-archived account exists', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findActiveUserByEmail('ghost@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('re-hashes the new password with a fresh salt and persists it (F8.5.2)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        passwordHash: 'old-hash',
        passwordSalt: 'old-salt',
      });

      await expect(
        service.updatePassword(7, 'NewStrongPassw0rd!'),
      ).resolves.toBeUndefined();

      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({ id: 7 });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          passwordHash: 'ab'.repeat(64),
          passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
          isLocked: false,
        }),
      );
    });

    it('clears the lock on a successful reset', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isLocked: true,
      });

      await service.updatePassword(7, 'NewStrongPassw0rd!');

      // The bootstrap admin is seated locked on a discarded password; the
      // reset write must unseat it in the same save as the new hash.
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          isLocked: false,
        }),
      );
    });

    it('rejects a user id with no matching account', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { id: 7 }),
      );

      await expect(
        service.updatePassword(7, 'NewStrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.updatePassword(7, 'NewStrongPassw0rd!'),
      ).rejects.toThrow('db down');
    });
  });

  describe('checkUserAndReturnInfo', () => {
    it('returns the public info when the credentials match', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [],
        isAdmin: false,
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

  describe('getUserById', () => {
    it('returns the user plus their persisted roles and admin flag', async () => {
      userRepository.findOneBy.mockResolvedValue({
        ...registeredUser,
        roles: [Role.Requester, Role.Courier],
      });

      await expect(service.getUserById(7)).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester, Role.Courier],
        isAdmin: false,
      });
      expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: 7 });
    });

    it('returns null when the account no longer exists', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getUserById(7)).resolves.toBeNull();
    });

    it('treats a missing roles value as an empty set', async () => {
      userRepository.findOneBy.mockResolvedValue({
        ...registeredUser,
        roles: undefined,
      });

      await expect(service.getUserById(7)).resolves.toMatchObject({
        roles: [],
      });
    });
  });

  describe('updateRoles', () => {
    it('persists the set-replaced roles and returns the stored state', async () => {
      const storedUser = {
        ...registeredUser,
        roles: [Role.Courier],
      };
      userRepository.findOneByOrFail.mockResolvedValue(storedUser);
      // The save mock stamps an id back onto the row; assign an explicit
      // post-save roles value to model a real subsequent read.
      userRepository.save.mockImplementation(async (row) => ({
        ...row,
        id: 7,
      }));

      await expect(
        service.updateRoles(7, [Role.Requester, Role.Courier]),
      ).resolves.toEqual({
        id: 7,
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester, Role.Courier],
        isAdmin: false,
      });

      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({ id: 7 });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          roles: [Role.Requester, Role.Courier],
        }),
      );
    });

    it('normalises duplicate roles to a set', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        roles: [],
      });

      const saved = await service.updateRoles(7, [
        Role.Requester,
        Role.Requester,
      ]);

      expect(saved.roles).toEqual([Role.Requester]);
    });

    it('allows opting out of every role', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        roles: [Role.Requester],
      });

      await expect(service.updateRoles(7, [])).resolves.toMatchObject({
        roles: [],
      });
    });

    it('rejects a user id with no matching account', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { id: 7 }),
      );

      await expect(service.updateRoles(7, [Role.Requester])).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(service.updateRoles(7, [Role.Requester])).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('listUsers', () => {
    it('lists the whole directory in a stable order with the paged window', async () => {
      userRepository.findAndCount.mockResolvedValue([
        [{ id: 1 }, { id: 2 }],
        42,
      ]);

      await expect(
        service.listUsers({ offset: 0, limit: 25 }),
      ).resolves.toEqual({
        users: [{ id: 1 }, { id: 2 }],
        total: 42,
        offset: 0,
        limit: 25,
      });

      // Unfiltered: empty where, N3.1.2 default window, deterministic
      // ordering for stable pagination across pages.
      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 25,
        order: { id: 'ASC' },
      });
    });

    it('filters by a participant role via array containment (F10.3)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.listUsers({ role: Role.Requester, offset: 5, limit: 10 });

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: { roles: ArrayContains([Role.Requester]) },
        skip: 5,
        take: 10,
        order: { id: 'ASC' },
      });
    });

    it('combines the admin-only account flags when supplied (F10.4)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.listUsers({
        isAdmin: true,
        isLocked: false,
        isArchived: true,
        offset: 0,
        limit: 1,
      });

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: { isAdmin: true, isLocked: false, isArchived: true },
        skip: 0,
        take: 1,
        order: { id: 'ASC' },
      });
    });

    it('clamps a requested limit to the 1000 hard ceiling (N3.1.1)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: 0, limit: 5000 });

      expect(result.limit).toBe(1000);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1000 }),
      );
    });

    it('floors a negative offset to the first page', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: -5, limit: 1 });

      expect(result.offset).toBe(0);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('raises a sub-minimum limit to one row', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: 0, limit: 0 });

      expect(result.limit).toBe(1);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
